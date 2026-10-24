"""Combine public TAMU lamp inventories and OSM lighting evidence on the walk graph.

Run after 04_graph.py. --input accepts a cached Overpass JSON or OSM XML extract.
No download occurs during route requests. Missing lighting evidence stays unknown.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import pickle
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from pyproj import Transformer
from shapely.geometry import LineString, Point, mapping
from shapely.strtree import STRtree

try:
    from lighting_sources import SOURCES, fetch_source, merge_lamps
except ImportError:
    from pipeline.lighting_sources import SOURCES, fetch_source, merge_lamps

DATA = Path(__file__).resolve().parents[1] / "data"
STEP_M = 2.0
RADIUS_M = 12.0  # Conservative proximity estimate, not measured illuminance.
STATES = ("mapped", "estimated", "unlit", "unknown", "conflict")
ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"


def request(url, payload=None):
    req = urllib.request.Request(url, data=payload, headers={
        "User-Agent": "SunScreen/1.0 (campus lighting research)",
        "Accept": "application/json, application/xml, text/xml",
    })
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read()


def read_elements(raw):
    if raw.lstrip().startswith(b"{"):
        data = json.loads(raw)
        if data.get("remark"):
            raise ValueError(f"Incomplete OSM response: {data['remark']}")
        if "elements" not in data:
            raise ValueError("Expected an OSM elements array")
        return data["elements"]
    root = ET.fromstring(raw)
    if root.tag != "osm":
        raise ValueError("Expected an OSM XML extract")
    nodes = {int(n.attrib["id"]): {"lon": float(n.attrib["lon"]), "lat": float(n.attrib["lat"])}
             for n in root.findall("node")}
    elements = []
    for kind in ("node", "way"):
        for element in root.findall(kind):
            item = {"type": kind, "id": int(element.attrib["id"]),
                    "tags": {t.attrib["k"]: t.attrib["v"] for t in element.findall("tag")}}
            if kind == "node":
                item.update(nodes[item["id"]])
            else:
                refs = [int(n.attrib["ref"]) for n in element.findall("nd")]
                if not all(n in nodes for n in refs):
                    continue
                item["geometry"] = [nodes[n] for n in refs]
            elements.append(item)
    return elements


def fetch(area, folder, refresh=False):
    cached = folder / "osm.raw"
    manifest = folder / "osm.request.json"
    request_key = {"bbox": area["bbox_wgs84"], "buffer_m": 40}
    saved = json.loads(manifest.read_text()) if manifest.exists() else {}
    if cached.exists() and saved.get("request") == request_key and not refresh:
        return read_elements(cached.read_bytes()), saved["endpoint"], cached.stat().st_mtime
    west, south, east, north = area["bbox_wgs84"]
    # Buffer also catches lamps just beyond the graph boundary.
    dy = 40 / 110540
    dx = 40 / (111320 * math.cos(math.radians((south + north) / 2)))
    west, south, east, north = west - dx, south - dy, east + dx, north + dy
    bbox = f"{south},{west},{north},{east}"
    query = f'[out:json][timeout:60];(node["highway"="street_lamp"]({bbox});way["highway"]["lit"]({bbox}););out meta geom;'
    sources = [
        ("https://overpass-api.de/api/interpreter", urllib.parse.urlencode({"data": query}).encode()),
        ("https://overpass.kumi.systems/api/interpreter", urllib.parse.urlencode({"data": query}).encode()),
        (f"https://api.openstreetmap.org/api/0.6/map?bbox={west},{south},{east},{north}", None),
    ]
    errors = []
    for url, payload in sources:
        try:
            raw = request(url, payload)
            elements = read_elements(raw)
            cached.write_bytes(raw)
            manifest.write_text(json.dumps({"request": request_key, "endpoint": url.split("?")[0]}))
            return elements, url.split("?")[0], cached.stat().st_mtime
        except Exception as error:
            errors.append(f"{url.split('?')[0]}: {error}")
    raise RuntimeError("No complete lighting extract downloaded. Existing graph retained.\n" + "\n".join(errors))


def normalize(elements, project):
    lamps, ways, features = [], [], []
    seen = set()
    for element in elements:
        identity = (element["type"], element["id"])
        if identity in seen:
            continue
        seen.add(identity)
        tags = element.get("tags", {})
        kind = element["type"]
        if kind == "node" and tags.get("highway") == "street_lamp":
            geom = Point(element["lon"], element["lat"])
            # Do not treat known broken/disused lamps or unusual schedules as working.
            inactive = any(tags.get(k) == "yes" for k in ("disused", "abandoned"))
            inactive |= tags.get("operational_status") in ("broken", "out_of_order", "inactive")
            inactive |= tags.get("light:lit") in ("no", "disused")
            schedule = tags.get("light:lit", tags.get("opening_hours", ""))
            eligible = not inactive and schedule in ("", "yes", "24/7", "dusk-dawn", "sunset-sunrise")
            if eligible:
                lamps.append(Point(*project(geom.x, geom.y)))
        elif kind == "way" and tags.get("highway") and tags.get("lit") and len(element.get("geometry", [])) >= 2:
            geom = LineString([(p["lon"], p["lat"]) for p in element["geometry"]])
            metric = LineString([project(x, y) for x, y in geom.coords])
            if tags["lit"] in ("yes", "no", "24/7", "sunset-sunrise", "dusk-dawn"):
                ways.append((metric, "unlit" if tags["lit"] == "no" else "mapped"))
        else:
            continue
        features.append({"type": "Feature", "geometry": mapping(geom),
                         "properties": {"osm_type": kind, "osm_id": element["id"], **tags}})
    return lamps, ways, features


def classify(point, lamp_tree, way_tree, way_states, radius):
    matches = {way_states[int(i)] for i in way_tree.query(point.buffer(1.0))
               if way_tree.geometries[int(i)].distance(point) <= 1.0}
    nearby = any(lamp_tree.geometries[int(i)].distance(point) <= radius
                 for i in lamp_tree.query(point.buffer(radius)))
    if ("mapped" in matches and "unlit" in matches) or ("unlit" in matches and nearby):
        return "conflict"
    if "mapped" in matches:
        return "mapped"
    if "unlit" in matches:
        return "unlit"
    return "estimated" if nearby else "unknown"


def annotate(graph, lamps, ways, project, radius):
    lamp_tree = STRtree(lamps)
    way_tree = STRtree([geom for geom, state in ways])
    way_states = [state for geom, state in ways]
    totals = Counter()
    for u, v, key, edge in graph.edges(keys=True, data=True):
        line = LineString([project(*p) for p in edge["coords"]])
        size = max(1, math.ceil(line.length / STEP_M))
        # Equal-length midpoint samples avoid endpoint bias and preserve gap lengths.
        runs = []
        counts = Counter()
        for i in range(size):
            state = classify(line.interpolate((i + 0.5) * line.length / size), lamp_tree, way_tree, way_states, radius)
            counts[state] += 1
            if runs and runs[-1][2] == state:
                runs[-1][1] = (i + 1) / size
            else:
                runs.append([i / size, (i + 1) / size, state])
        edge["lighting"] = {state: counts[state] / size for state in STATES}
        edge["lighting"]["runs"] = runs
        for state in STATES:
            totals[state] += edge["length"] * counts[state] / size
    total = sum(totals.values())
    return {state: round(totals[state] / total, 4) if total else 0 for state in STATES}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--input", type=Path, help="Overpass JSON or OSM XML extract")
    parser.add_argument("--radius", type=float, default=RADIUS_M)
    parser.add_argument("--osm-only", action="store_true", help="explicitly omit campus inventories (baseline/audit)")
    args = parser.parse_args()
    if not 0 < args.radius <= 50:
        parser.error("--radius must be between 0 and 50 meters")
    area = json.loads((DATA / "area.json").read_text())
    folder = DATA / "lighting"
    folder.mkdir(exist_ok=True)
    if args.input:
        elements, source, timestamp = read_elements(args.input.read_bytes()), "local OSM extract", args.input.stat().st_mtime
    else:
        elements, source, timestamp = fetch(area, folder, args.refresh)
    project = Transformer.from_crs("EPSG:4326", area["crs"], always_xy=True).transform
    lamps, ways, features = normalize(elements, project)
    osm_count = len(lamps)
    summaries, contributions, source_errors = [], {"osm": osm_count}, []
    if not args.osm_only:
        snapshots = []
        for definition in SOURCES:
            try:
                snapshots.append(fetch_source(definition, area, folder / "cache", args.refresh))
            except Exception as error:
                if definition["id"] == "tamu_streetlight":
                    raise RuntimeError("Campus lamp inventory unavailable; existing graph retained. Use --osm-only only for an intentional OSM baseline.") from error
                source_errors.append({"id": definition["id"], "error": str(error)})
        lamps, campus_features, summaries, contributions = merge_lamps(lamps, snapshots, project)
        features.extend(campus_features)
    with (DATA / "graph.pkl").open("rb") as stream:
        graph = pickle.load(stream)
    coverage = annotate(graph, lamps, ways, project, args.radius)
    metadata = {"source": "TAMU GIS + OpenStreetMap" if summaries else "OpenStreetMap", "endpoint": source,
                "bbox_wgs84": area["bbox_wgs84"],
                "retrieved_at": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),
                "processed_at": datetime.now(timezone.utc).isoformat(),
                "lamp_count": len(lamps), "osm_lamp_count": osm_count, "tagged_way_count": len(ways),
                "sources": summaries, "source_errors": source_errors, "unique_lamps_by_source": contributions,
                "radius_m": args.radius, "sample_step_m": STEP_M, "coverage": coverage,
                "attribution": "TAMU campus GIS; " + ATTRIBUTION if summaries else ATTRIBUTION,
                "license_url": "https://www.openstreetmap.org/copyright",
                "terms_note": "ODbL applies to OSM. TAMU item license fields are unspecified; retain separate provenance and confirm reuse terms before external redistribution.",
                "model": f"{args.radius:g} m lamp proximity estimate, not measured illuminance or live outage data. Removed/sign-only inventory records excluded; historical passing inspections supplement locations."}
    graph.graph["lighting"] = metadata
    geojson = json.loads((DATA / "graph.geojson").read_text())
    for feature in geojson["features"]:
        props = feature["properties"]
        props["lighting"] = graph[props["u"]][props["v"]][props["key"]]["lighting"]
    # Prepare both graph files before replacing either published output.
    target = DATA / "graph.pkl"
    temporary = target.with_suffix(".tmp")
    geo_target = DATA / "graph.geojson"
    geo_temporary = geo_target.with_suffix(".tmp.json")
    geo_temporary.write_text(json.dumps(geojson))
    with temporary.open("wb") as stream:
        pickle.dump(graph, stream)
    geo_temporary.replace(geo_target)
    temporary.replace(target)
    (folder / "lights.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    (folder / "coverage.json").write_text(json.dumps(metadata, indent=2))
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
