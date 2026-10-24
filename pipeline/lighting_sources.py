"""Bounded, read-only imports from verified public TAMU lamp layers.

Only lamp geometry and physical/status fields are requested. No requestor,
inspector, contact, electrical-feed, or internal circuit fields are downloaded.
Public access is recorded separately from an open license: TAMU's item license
fields are blank. Do not label these observations ODbL or publish an OSM import.
"""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import time
import urllib.parse
import urllib.request

from shapely.geometry import Point
from shapely.strtree import STRtree

BASE = "https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/"
SOURCES = (
    {"id": "tamu_streetlight", "name": "TAMU Streetlight inventory", "item_id": "6789572816e4423080aacd7f8e763074",
     "url": BASE + "Streetlight/FeatureServer/297", "oid": "FID",
     "fields": "FID,POLE_TYPE,Pole_Use,Status,FixtureTyp,LampType,EditDate"},
    {"id": "tamu_survey", "name": "TAMU Lighting Survey", "item_id": "84ba426f85b941bb8d35197e316571d4",
     "url": BASE + "survey123_e4683e97abd84e13bc7c11a35db139ec_stakeholder/FeatureServer/0", "oid": "ObjectId",
     "fields": "ObjectId,field_4,field_15,field_51,EditDate"},
)
CACHE_VERSION = 1
MAX_AGE_DAYS = 30
DEDUP_M = 3.0


def query(url, params):
    address = url + "?" + urllib.parse.urlencode({"f": "json", **params})
    for attempt in range(3):
        try:
            req = urllib.request.Request(address, headers={"User-Agent": "SunScreen/1.0 (public campus lamp mapping)", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.load(response)
            if result.get("error"):
                raise ValueError(f"ArcGIS error: {result['error']}")
            return result
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def bbox_with_buffer(area):
    west, south, east, north = area["bbox_wgs84"]
    dy = 40 / 110540
    dx = 40 / (111320 * math.cos(math.radians((south + north) / 2)))
    return [west - dx, south - dy, east + dx, north + dy]


def fetch_source(source, area, folder, refresh=False):
    """Validate a complete ID-based snapshot before atomically caching it."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    cache = folder / (source["id"] + ".json")
    key = {"version": CACHE_VERSION, "bbox": bbox_with_buffer(area), "url": source["url"], "fields": source["fields"]}
    saved = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    usable = saved.get("request") == key
    now = datetime.now(timezone.utc)
    if usable and not refresh and (now - datetime.fromisoformat(saved["retrieved_at"])).total_seconds() < MAX_AGE_DAYS * 86400:
        return saved
    try:
        metadata = query(source["url"], {})
        if metadata.get("geometryType") != "esriGeometryPoint":
            raise ValueError("Expected lamp point geometry")
        result = query(source["url"] + "/query", {
            "where": "1=1", "geometry": ",".join(map(str, key["bbox"])),
            "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects", "returnIdsOnly": "true",
        })
        if "objectIds" not in result:
            raise ValueError("Source did not return object IDs")
        ids = sorted(set(result["objectIds"] or []))
        def page(batch):
            data = query(source["url"] + "/query", {
                "objectIds": ",".join(map(str, batch)), "outFields": source["fields"],
                "outSR": 4326, "returnGeometry": "true",
            })
            if data.get("exceededTransferLimit"):
                raise ValueError("Truncated lamp download")
            return data.get("features", [])
        with ThreadPoolExecutor(max_workers=4) as executor:
            pages = list(executor.map(page, [ids[i:i+100] for i in range(0, len(ids), 100)]))
        features = [f for page_features in pages for f in page_features]
        if len(features) != len(ids) or {f["attributes"][source["oid"]] for f in features} != set(ids):
            raise ValueError("Lamp snapshot is incomplete or has duplicate IDs")
        saved = {"request": key, "retrieved_at": now.isoformat(), "features": features,
                 "layer_updated_ms": metadata.get("editingInfo", {}).get("dataLastEditDate"),
                 "source": source, "terms": "Publicly queryable TAMU GIS; no explicit open license supplied in item metadata."}
        temporary = cache.with_suffix(".tmp")
        temporary.write_text(json.dumps(saved), encoding="utf-8")
        temporary.replace(cache)
        return saved
    except Exception as error:
        if usable:
            return {**saved, "refresh_error": str(error), "using_cached_snapshot": True}
        raise


def clean(value):
    return str(value or "").strip().lower()


def normalize_source(snapshot, project):
    source = snapshot["source"]
    west, south, east, north = snapshot["request"]["bbox"]
    accepted, removed, excluded = [], [], Counter()
    for feature in snapshot["features"]:
        attributes = feature["attributes"]
        geometry = feature.get("geometry") or {}
        x, y = geometry.get("x"), geometry.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not (west <= x <= east and south <= y <= north):
            excluded["invalid_geometry"] += 1
            continue
        point = Point(*project(x, y))
        if source["id"] == "tamu_streetlight":
            status = clean(attributes.get("Status"))
            if status in ("removed", "retired", "abandoned", "proposed", "inactive"):
                removed.append(point)
                excluded["non_existing"] += 1
                continue
            if clean(attributes.get("Pole_Use")) == "sign":
                excluded["sign_only"] += 1
                continue
            kind = clean(attributes.get("POLE_TYPE")) or "unspecified"
        else:
            # An old structural inspection is not a live lamp-outage observation.
            # Only passing records supplement presence; Fail is never called unlit.
            if attributes.get("field_15") != "choice0":
                excluded["survey_not_passed"] += 1
                continue
            types = {"choice0": "street", "choice4": "bollard", "choice5": "security", "choice6": "parking lot", "choice7": "sidewalk"}
            kind = types.get(attributes.get("field_51"))
            if not kind:
                excluded["unsupported_survey_type"] += 1
                continue
            status = "historical passing inspection; current operation unknown"
        accepted.append({"point": point, "feature": {
            "type": "Feature", "geometry": {"type": "Point", "coordinates": [x, y]},
            "properties": {"source": source["id"], "source_id": attributes[source["oid"]],
                           "source_url": source["url"], "fixture_kind": kind,
                           "reported_status": status or "unspecified; operation unknown"},
        }})
    return accepted, removed, dict(excluded)


def merge_lamps(osm_lamps, snapshots, project):
    """Prefer current inventory, then historical survey, then OSM; dedupe by 3 m."""
    candidates, removed, summaries = [], [], []
    for snapshot in snapshots:
        accepted, retired, excluded = normalize_source(snapshot, project)
        candidates.extend(accepted)
        removed.extend(retired)
        summaries.append({"id": snapshot["source"]["id"], "name": snapshot["source"]["name"],
                          "url": snapshot["source"]["url"], "item_id": snapshot["source"]["item_id"],
                          "retrieved_at": snapshot["retrieved_at"], "layer_updated_ms": snapshot["layer_updated_ms"],
                          "downloaded": len(snapshot["features"]), "eligible_before_dedup": len(accepted),
                          "excluded": excluded, "terms": snapshot["terms"],
                          **({"refresh_error": snapshot["refresh_error"]} if snapshot.get("refresh_error") else {})})
    retired_tree = STRtree(removed)
    cells, points, features, contributions = {}, [], [], Counter()
    def add(point, feature, source):
        if len(retired_tree.query(point, predicate="dwithin", distance=DEDUP_M)):
            return
        cx, cy = math.floor(point.x / DEDUP_M), math.floor(point.y / DEDUP_M)
        if any(p.distance(point) <= DEDUP_M for x in range(cx-1, cx+2) for y in range(cy-1, cy+2) for p in cells.get((x, y), [])):
            return
        cells.setdefault((cx, cy), []).append(point)
        points.append(point)
        if feature:
            features.append(feature)
        contributions[source] += 1
    for candidate in candidates:
        add(candidate["point"], candidate["feature"], candidate["feature"]["properties"]["source"])
    for point in osm_lamps:
        add(point, None, "osm")
    for summary in summaries:
        summary["unique_contribution"] = contributions[summary["id"]]
    return points, features, summaries, dict(contributions)
