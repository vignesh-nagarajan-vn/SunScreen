"""Geocode the two endpoints and write data/area.json with a buffered bbox."""
import argparse
import json
from pathlib import Path

import osmnx as ox
from pyproj import Transformer

DATA = Path(__file__).resolve().parents[1] / "data"
CRS = "EPSG:6343"  # NAD83(2011) / UTM 14N
BUFFER_M = 300

START = "Commons Dining Hall, College Station, TX"  # Nominatim has no "The Commons, Texas A&M"
END = "Zachry Engineering Education Complex, College Station, TX"


def latlon(s):
    lat, lon = (float(v) for v in s.split(","))
    return lat, lon


p = argparse.ArgumentParser()
p.add_argument("--start", type=latlon, help="override start as 'lat,lon'")
p.add_argument("--end", type=latlon, help="override end as 'lat,lon'")
args = p.parse_args()

points = {}
for name, query, override in [("start", START, args.start), ("end", END, args.end)]:
    if override:
        lat, lon = override
        source = "cli"
    else:
        lat, lon = ox.geocode(query)
        source = "nominatim"
    points[name] = {"name": query, "lat": lat, "lon": lon, "source": source}
    print(f"{name:5s} {lat:.6f}, {lon:.6f}  ({source}: {query})")

to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
to_wgs = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
xs, ys = zip(*(to_utm.transform(pt["lon"], pt["lat"]) for pt in points.values()))
# Snap to whole metres so every raster shares the same 1 m grid.
bbox_utm = [
    int(min(xs) - BUFFER_M), int(min(ys) - BUFFER_M),
    int(max(xs) + BUFFER_M) + 1, int(max(ys) + BUFFER_M) + 1,
]
lons, lats = to_wgs.transform(
    [bbox_utm[0], bbox_utm[2], bbox_utm[2], bbox_utm[0]],
    [bbox_utm[1], bbox_utm[1], bbox_utm[3], bbox_utm[3]],
)
west, south, east, north = min(lons), min(lats), max(lons), max(lats)

area = {
    **points,
    "crs": CRS,
    "buffer_m": BUFFER_M,
    "bbox_utm": bbox_utm,
    "bbox_wgs84": [west, south, east, north],
}
DATA.mkdir(exist_ok=True)
(DATA / "area.json").write_text(json.dumps(area, indent=2))
w, h = bbox_utm[2] - bbox_utm[0], bbox_utm[3] - bbox_utm[1]
print(f"bbox {w} x {h} m -> {DATA / 'area.json'}")
