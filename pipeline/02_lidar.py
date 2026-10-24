"""Fetch LiDAR for the bbox and write 1 m DTM, DSM and CHM GeoTIFFs (EPSG:6343).

Sources, in order:
  1. .laz tiles already in data/raw/
  2. TxGIO StratMap 2025 Brazos tiles (public S3), downloaded into data/raw/
  3. the USGS 3DEP public EPT on AWS, read with PDAL readers.ept
Points are processed one tile (or 1 km chunk) at a time to keep memory flat.
"""
import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

import geopandas as gpd
import numpy as np
import pdal
import rasterio
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import box, shape

DATA = Path(__file__).resolve().parents[1] / "data"
RAW = DATA / "raw"
TXGIO = "https://tnris-data-warehouse.s3.us-east-1.amazonaws.com/LCD/collection/stratmap-2025-50cm-little-middle-lower-brazos-basins"
TXGIO_INDEX = f"{TXGIO}/assets/index/stratmap-2025-little-middle-lower-brazos-basins_index.zip"
RESOURCES = "https://raw.githubusercontent.com/hobuinc/usgs-lidar/master/boundaries/resources.geojson"
NODATA = -9999.0
MAX_HEIGHT_M = 120  # nothing on campus is taller; higher returns are birds/noise
CHUNK_M = 1000

area = json.loads((DATA / "area.json").read_text())
x0, y0, x1, y1 = area["bbox_utm"]
crs = area["crs"]
POINTS = DATA / "_points.laz"


def txgio_tiles():
    """Download the TxGIO 2025 point-cloud tiles that touch the bbox into data/raw/."""
    with urllib.request.urlopen(TXGIO_INDEX, timeout=120) as r:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(RAW / "_index")
    index = gpd.read_file(next((RAW / "_index").glob("*lpc-utm14*.shp"))).to_crs(crs)
    hits = index[index.intersects(box(x0, y0, x1, y1))]
    print(f"TxGIO 2025: {len(hits)} tiles touch the bbox")
    for quad in hits["Quad64th"]:
        dest = RAW / f"stratmap-2025-50cm-lmlbb_{quad}.laz"
        if not dest.exists():
            print(f"  downloading {dest.name}", flush=True)
            urllib.request.urlretrieve(f"{TXGIO}/items/lpc/{dest.name}", dest.with_suffix(".part"))
            dest.with_suffix(".part").rename(dest)
    return sorted(RAW.glob("*.laz"))


def ept_chunks():
    """Newest 3DEP EPT dataset covering the bbox, split into 1 km reads."""
    with urllib.request.urlopen(RESOURCES, timeout=60) as r:
        features = json.load(r)["features"]
    hits = [f["properties"] for f in features if shape(f["geometry"]).intersects(box(*area["bbox_wgs84"]))]
    if not hits:
        sys.exit("No USGS 3DEP EPT dataset covers this bbox. Put .laz tiles in data/raw/ instead.")
    year = lambda p: max(map(int, re.findall(r"(?<!\d)(20\d\d)(?!\d)", p["name"])), default=0)
    best = max(hits, key=year)
    print(f"using USGS 3DEP {best['name']}")
    t = Transformer.from_crs(crs, "EPSG:3857", always_xy=True)  # EPT data is stored in EPSG:3857
    for cx in range(x0, x1, CHUNK_M):
        for cy in range(y0, y1, CHUNK_M):
            ex, ey = min(cx + CHUNK_M, x1), min(cy + CHUNK_M, y1)
            mx, my = t.transform([cx, ex, ex, cx], [cy, cy, ey, ey])
            bounds = f"([{min(mx) - 20}, {max(mx) + 20}], [{min(my) - 20}, {max(my) + 20}])"
            yield f"EPT chunk {cx},{cy}", [{"type": "readers.ept", "filename": best["url"], "bounds": bounds, "threads": 8}], (cx, cy, ex, ey)


def rasterize(name, limits, output_type):
    """Clipped points -> filtered -> 1 m grid on the shared origin."""
    path = DATA / f"_{name}_raw.tif"
    spec = [
        {"type": "readers.las", "filename": str(POINTS)},
        {"type": "filters.range", "limits": limits},
        {"type": "writers.gdal", "filename": str(path), "resolution": 1,
         "output_type": output_type, "data_type": "float32", "nodata": NODATA,
         "origin_x": x0, "origin_y": y0, "width": x1 - x0, "height": y1 - y0},
    ]
    try:
        if pdal.Pipeline(json.dumps(spec)).execute() == 0:
            return None
    except RuntimeError:  # writers.gdal refuses to write a grid with no points
        return None
    with rasterio.open(path) as src:
        return src.read(1), src.profile


def process(label, readers, crop):
    """Clean one tile/chunk of points and return its stats and rasters on the full grid."""
    cx0, cy0, cx1, cy1 = crop
    spec = readers + [
        {"type": "filters.reprojection", "out_srs": crs},
        {"type": "filters.crop", "bounds": f"([{cx0}, {cx1}], [{cy0}, {cy1}])"},
        {"type": "filters.outlier", "method": "statistical", "mean_k": 8, "multiplier": 3},  # marks noise as class 7
        {"type": "filters.expression", "expression": "Classification != 7 && Classification != 18"},
        {"type": "filters.stats", "dimensions": "Z,GpsTime,Classification", "count": "Classification"},
        {"type": "writers.las", "filename": str(POINTS), "compression": True, "forward": "all"},
    ]
    pipeline = pdal.Pipeline(json.dumps(spec))
    n = pipeline.execute()
    print(f"{label}: {n:,} points", flush=True)
    if n == 0:
        return None
    stats = {s["name"]: s for s in pipeline.metadata["metadata"]["filters.stats"]["statistic"]}
    layers = {
        "dtm": rasterize("dtm", "Classification[2:2]", "mean"),
        "dsm": rasterize("dsm", "ReturnNumber[1:1]", "max"),
        "veg": rasterize("veg", "Classification[3:5]", "max"),
    }
    return stats, layers


laz = sorted(RAW.glob("*.laz"))
if not laz:
    try:
        laz = txgio_tiles()
    except Exception as e:  # say so plainly, then use the documented fallback
        print(f"TxGIO download failed ({e}); falling back to USGS 3DEP EPT")
if laz:
    print(f"using {len(laz)} local tile(s) from data/raw/")
    sources = ((f.name, [{"type": "readers.las", "filename": str(f)}], (x0, y0, x1, y1)) for f in laz)
else:
    sources = ept_chunks()

grids, profile = {}, None
total, classes, gps_min, gps_max = 0, {}, np.inf, -np.inf
for label, readers, crop in sources:
    result = process(label, readers, crop)
    if not result:
        continue
    stats, layers = result
    total += stats["Z"]["count"]
    for c in stats["Classification"].get("counts", []):
        value, count = c.split("/")
        classes[int(float(value))] = classes.get(int(float(value)), 0) + int(count)
    if "GpsTime" in stats:
        gps_min, gps_max = min(gps_min, stats["GpsTime"]["minimum"]), max(gps_max, stats["GpsTime"]["maximum"])
    for name, layer in layers.items():
        if layer is None:
            continue
        arr, profile = layer
        if name not in grids:
            grids[name] = arr
        elif name == "dtm":  # tiles don't overlap much; keep the first valid ground value
            grids[name] = np.where(grids[name] == NODATA, arr, grids[name])
        else:
            grids[name] = np.maximum(grids[name], arr)

# ---- log density, classes and acquisition date --------------------------------
print(f"points in bbox: {total:,}  density: {total / ((x1 - x0) * (y1 - y0)):.1f} pts/m^2")
print(f"class counts: {dict(sorted(classes.items()))}")
if "veg" not in grids:
    print("WARNING: no vegetation points (classes 3-5) in this dataset; CHM will be all zero. "
          "Tree cover still comes through the DSM (first returns) and DSM-DTM.")
if gps_max > 604800:  # adjusted standard GPS time, not GPS week seconds
    epoch = datetime(1980, 1, 6)
    first, last = epoch + timedelta(seconds=gps_min + 1e9), epoch + timedelta(seconds=gps_max + 1e9)
    print(f"acquisition dates (from GpsTime): {first:%Y-%m-%d} to {last:%Y-%m-%d}")
else:
    print("acquisition date: not available (GpsTime is week-seconds or missing)")


# ---- fill gaps, derive CHM, write final rasters ---------------------------------
def fill_nearest(a):
    missing = a == NODATA
    idx = ndimage.distance_transform_edt(missing, return_distances=False, return_indices=True)
    return a[tuple(idx)]


if "dtm" not in grids or (grids["dtm"] == NODATA).all():
    sys.exit("No ground points (class 2) in the bbox; cannot build a DTM.")
dtm, dsm = grids["dtm"], grids["dsm"]
veg = grids.get("veg", np.full_like(dtm, NODATA))
print(f"empty cells: dtm {np.mean(dtm == NODATA):.0%}, dsm {np.mean(dsm == NODATA):.0%} (filled by nearest)")
dtm = fill_nearest(dtm)
dsm = np.where(dsm == NODATA, dtm, dsm)
too_tall = dsm - dtm > MAX_HEIGHT_M
if too_tall.any():
    print(f"dropped {too_tall.sum()} DSM cells > {MAX_HEIGHT_M} m above ground as noise")
dsm = np.where(too_tall, dtm, np.maximum(dsm, dtm))
chm = np.where((veg == NODATA) | (veg - dtm > MAX_HEIGHT_M), 0, np.clip(veg - dtm, 0, None))

profile.update(nodata=None, compress="deflate")
for name, arr in [("dtm", dtm), ("dsm", dsm), ("chm", chm)]:
    with rasterio.open(DATA / f"{name}.tif", "w", **profile) as dst:
        dst.write(arr.astype("float32"), 1)
for name in ("dtm", "dsm", "veg"):
    (DATA / f"_{name}_raw.tif").unlink(missing_ok=True)
POINTS.unlink(missing_ok=True)
print(f"wrote dtm.tif, dsm.tif, chm.tif ({x1 - x0} x {y1 - y0} px, 1 m, {crs})")
print(f"max height above ground: dsm {np.max(dsm - dtm):.1f} m, chm {chm.max():.1f} m, tree cover > 2.5 m: {np.mean(chm > 2.5):.0%}")
