"""Fetch LiDAR for the bbox and write 1 m DTM, DSM and CHM GeoTIFFs (EPSG:6343).

Source: .laz tiles in data/raw/ if present (e.g. TxGIO 2025 Brazos), otherwise the
USGS 3DEP public EPT on AWS, read with PDAL readers.ept clipped to the bbox.
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pdal
import rasterio
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import box, shape

DATA = Path(__file__).resolve().parents[1] / "data"
RESOURCES = "https://raw.githubusercontent.com/hobuinc/usgs-lidar/master/boundaries/resources.geojson"
NODATA = -9999.0
MAX_HEIGHT_M = 120  # nothing on campus is taller; higher returns are birds/noise

area = json.loads((DATA / "area.json").read_text())
x0, y0, x1, y1 = area["bbox_utm"]
crs = area["crs"]


def ept_reader():
    """Pick the newest 3DEP EPT dataset covering the bbox."""
    with urllib.request.urlopen(RESOURCES, timeout=60) as r:
        features = json.load(r)["features"]
    aoi = box(*area["bbox_wgs84"])
    hits = [f["properties"] for f in features if shape(f["geometry"]).intersects(aoi)]
    if not hits:
        sys.exit("No USGS 3DEP EPT dataset covers this bbox. Put .laz tiles in data/raw/ instead.")
    year = lambda p: max(map(int, re.findall(r"(?<!\d)(20\d\d)(?!\d)", p["name"])), default=0)
    best = max(hits, key=year)
    print(f"3DEP EPT candidates: {[h['name'] for h in hits]}")
    print(f"using {best['name']}")
    # EPT data is stored in EPSG:3857; pad the request a little and crop after reprojecting.
    t = Transformer.from_crs(crs, "EPSG:3857", always_xy=True)
    mx, my = t.transform([x0, x1, x1, x0], [y0, y0, y1, y1])
    pad = 20
    bounds = f"([{min(mx) - pad}, {max(mx) + pad}], [{min(my) - pad}, {max(my) + pad}])"
    return [{"type": "readers.ept", "filename": best["url"], "bounds": bounds, "threads": 8}]


def laz_readers(files):
    print(f"using {len(files)} local tile(s) from data/raw/: {[f.name for f in files]}")
    return [{"type": "readers.las", "filename": str(f)} for f in files] + [{"type": "filters.merge"}]


POINTS = DATA / "_points.laz"


def rasterize(name, limits, output_type):
    """One linear PDAL pipeline: clipped points -> filtered -> 1 m grid on the shared origin."""
    spec = [
        {"type": "readers.las", "filename": str(POINTS)},
        {"type": "filters.range", "limits": limits},
        {"type": "writers.gdal", "filename": str(DATA / f"_{name}_raw.tif"), "resolution": 1,
         "output_type": output_type, "data_type": "float32", "nodata": NODATA,
         "origin_x": x0, "origin_y": y0, "width": x1 - x0, "height": y1 - y0},
    ]
    n = pdal.Pipeline(json.dumps(spec)).execute()
    print(f"{name}: {n:,} points")


laz = sorted((DATA / "raw").glob("*.laz"))
readers = laz_readers(laz) if laz else ept_reader()
spec = readers + [
    {"type": "filters.reprojection", "out_srs": crs},
    {"type": "filters.crop", "bounds": f"([{x0}, {x1}], [{y0}, {y1}])"},
    {"type": "filters.outlier", "method": "statistical", "mean_k": 8, "multiplier": 3},  # marks noise as class 7
    {"type": "filters.expression", "expression": "Classification != 7 && Classification != 18"},
    {"type": "filters.stats", "dimensions": "Z,GpsTime,Classification", "count": "Classification"},
    {"type": "writers.las", "filename": str(POINTS), "compression": True, "forward": "all"},
]
print("running PDAL (downloads the clipped point cloud; can take a few minutes)...", flush=True)
pipeline = pdal.Pipeline(json.dumps(spec))
pipeline.execute()

# ---- log density, classes and acquisition date --------------------------------
stats = {s["name"]: s for s in pipeline.metadata["metadata"]["filters.stats"]["statistic"]}
n = stats["Z"]["count"]
print(f"points in bbox: {n:,}  density: {n / ((x1 - x0) * (y1 - y0)):.1f} pts/m^2")
classes = {}
for c in stats["Classification"].get("counts", []):
    value, count = c.split("/")
    classes[int(float(value))] = int(count)
print(f"class counts: {dict(sorted(classes.items()))}")
has_veg = any(classes.get(c) for c in (3, 4, 5))
if not has_veg:
    print("WARNING: no vegetation points (classes 3-5) in this dataset; CHM will be all zero. "
          "Tree cover still comes through the DSM (first returns) and DSM-DTM.")
gps = stats.get("GpsTime", {})
if gps.get("maximum", 0) > 604800:  # adjusted standard GPS time, not GPS week seconds
    epoch = datetime(1980, 1, 6)
    first = epoch + timedelta(seconds=gps["minimum"] + 1e9)
    last = epoch + timedelta(seconds=gps["maximum"] + 1e9)
    print(f"acquisition dates (from GpsTime): {first:%Y-%m-%d} to {last:%Y-%m-%d}")
else:
    print("acquisition date: not available (GpsTime is week-seconds or missing)")


# ---- fill gaps, derive CHM, write final rasters ---------------------------------
def read(name):
    with rasterio.open(DATA / f"_{name}_raw.tif") as src:
        return src.read(1), src.profile


def fill_nearest(a):
    missing = a == NODATA
    if missing.all():
        return None
    idx = ndimage.distance_transform_edt(missing, return_distances=False, return_indices=True)
    return a[tuple(idx)]


rasterize("dtm", "Classification[2:2]", "mean")
rasterize("dsm", "ReturnNumber[1:1]", "max")
dtm, profile = read("dtm")
dsm, _ = read("dsm")
if has_veg:
    rasterize("veg", "Classification[3:5]", "max")
    veg, _ = read("veg")
else:
    veg = np.full_like(dtm, NODATA)
print(f"empty cells: dtm {np.mean(dtm == NODATA):.0%}, dsm {np.mean(dsm == NODATA):.0%} (filled by nearest)")
dtm = fill_nearest(dtm)
if dtm is None:
    sys.exit("No ground points (class 2) in the bbox; cannot build a DTM.")
dsm = np.where(dsm == NODATA, dtm, dsm)
too_tall = dsm - dtm > MAX_HEIGHT_M
if too_tall.any():
    print(f"dropped {too_tall.sum()} DSM cells > {MAX_HEIGHT_M} m above ground as noise")
dsm = np.where(too_tall, dtm, np.maximum(dsm, dtm))
chm = np.where(veg == NODATA, 0, np.clip(veg - dtm, 0, None))

profile.update(nodata=None, compress="deflate")
for name, arr in [("dtm", dtm), ("dsm", dsm), ("chm", chm)]:
    with rasterio.open(DATA / f"{name}.tif", "w", **profile) as dst:
        dst.write(arr.astype("float32"), 1)
    (DATA / f"_{name}_raw.tif").unlink(missing_ok=True)
(DATA / "_veg_raw.tif").unlink(missing_ok=True)
POINTS.unlink(missing_ok=True)
print(f"wrote dtm.tif, dsm.tif, chm.tif ({x1 - x0} x {y1 - y0} px, 1 m, {crs})")
print(f"max height above ground: dsm {np.max(dsm - dtm):.1f} m, chm {chm.max():.1f} m")
