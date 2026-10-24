"""Geocode campus places and write data/area.json with the routing area (places bbox + buffer)."""
import argparse
import json
from pathlib import Path

import osmnx as ox
from pyproj import Transformer

DATA = Path(__file__).resolve().parents[1] / "data"
CRS = "EPSG:6343"  # NAD83(2011) / UTM 14N
BUFFER_M = 400
# Geocodes outside this box are wrong matches (e.g. a "Haas Hall" in Germany) and are dropped.
CAMPUS = {"south": 30.585, "north": 30.635, "west": -96.365, "east": -96.325}

# id, category, display name, Nominatim query. Nominatim has no "The Commons", so it uses the dining hall.
PLACES = [
    ("commons", "Dining", "The Commons", "Commons Dining Hall, College Station"),
    ("zachry", "Academic", "Zachry Engineering", "Zachry Engineering Education Complex"),
    ("msc", "Student life", "Memorial Student Center", "Memorial Student Center, College Station"),
    ("evans", "Libraries", "Evans Library", "Sterling C. Evans Library"),
    ("academic", "Academic", "Academic Building", "Academic Building, College Station"),
    ("century_tree", "Landmarks", "Century Tree", "Century Tree, College Station"),
    ("rudder", "Landmarks", "Rudder Tower", "Rudder Tower"),
    ("ssb", "Student life", "Student Services Building", "Student Services Building, College Station"),
    ("kyle", "Athletics", "Kyle Field", "Kyle Field"),
    ("rec", "Athletics", "Student Rec Center", "Student Recreation Center, College Station"),
    ("reed", "Athletics", "Reed Arena", "Reed Arena"),
    ("sbisa", "Dining", "Sbisa Dining Hall", "Sbisa Dining Hall"),
    ("wehner", "Academic", "Mays Business School", "Wehner Building, College Station"),
    ("bell_tower", "Landmarks", "Albritton Bell Tower", "Albritton Bell Tower"),
    ("drill_field", "Landmarks", "Simpson Drill Field", "Simpson Drill Field"),
    ("corps", "Landmarks", "Corps of Cadets Center", "Corps of Cadets Center"),
    ("cushing", "Libraries", "Cushing Library", "Cushing Memorial Library"),
    ("blocker", "Academic", "Blocker Building", "Blocker Building, College Station"),
    ("langford", "Academic", "Langford Architecture", "Langford Architecture Center"),
    ("agls", "Academic", "AgriLife Sciences Building", "Agriculture and Life Sciences Building"),
    ("aggie_park", "Parks & neighborhoods", "Aggie Park", "Aggie Park, College Station"),
    ("spence_park", "Parks & neighborhoods", "Spence Park", "Spence Park, College Station"),
    ("bush_library", "Libraries", "Bush Library", "George Bush Presidential Library"),
    ("northgate", "Parks & neighborhoods", "Northgate", "Northgate, College Station"),
]
DEFAULT = ("commons", "zachry")


def override(s):
    pid, coords = s.split("=")
    lat, lon = (float(v) for v in coords.split(","))
    return pid, (lat, lon)


p = argparse.ArgumentParser()
p.add_argument("--place", type=override, action="append", default=[], help="override a place: id=lat,lon")
args = p.parse_args()
overrides = dict(args.place)

places = []
for pid, category, name, query in PLACES:
    if pid in overrides:
        (lat, lon), source = overrides[pid], "cli"
    else:
        try:
            lat, lon = ox.geocode(query)
        except Exception as e:
            print(f"SKIP {name}: Nominatim could not geocode '{query}' ({e.__class__.__name__})")
            continue
        source = "nominatim"
    if not (CAMPUS["south"] <= lat <= CAMPUS["north"] and CAMPUS["west"] <= lon <= CAMPUS["east"]):
        print(f"SKIP {name}: geocoded to {lat:.5f}, {lon:.5f}, outside campus")
        continue
    places.append({"id": pid, "name": name, "category": category, "lat": lat, "lon": lon, "source": source})
    print(f"{name:28s} {lat:.6f}, {lon:.6f}  ({source})")
ids = {pl["id"] for pl in places}
if not set(DEFAULT) <= ids:
    raise SystemExit(f"Default endpoints {DEFAULT} missing; pass --place id=lat,lon")

to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
to_wgs = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
xs, ys = to_utm.transform([pl["lon"] for pl in places], [pl["lat"] for pl in places])
# Snap to whole metres so every raster shares the same 1 m grid.
bbox_utm = [
    int(min(xs) - BUFFER_M), int(min(ys) - BUFFER_M),
    int(max(xs) + BUFFER_M) + 1, int(max(ys) + BUFFER_M) + 1,
]
lons, lats = to_wgs.transform(
    [bbox_utm[0], bbox_utm[2], bbox_utm[2], bbox_utm[0]],
    [bbox_utm[1], bbox_utm[1], bbox_utm[3], bbox_utm[3]],
)
area = {
    "places": places,
    "default": list(DEFAULT),
    "crs": CRS,
    "buffer_m": BUFFER_M,
    "bbox_utm": bbox_utm,
    "bbox_wgs84": [min(lons), min(lats), max(lons), max(lats)],
}
DATA.mkdir(exist_ok=True)
(DATA / "area.json").write_text(json.dumps(area, indent=2))
w, h = bbox_utm[2] - bbox_utm[0], bbox_utm[3] - bbox_utm[1]
print(f"{len(places)} places, bbox {w} x {h} m -> {DATA / 'area.json'}")
