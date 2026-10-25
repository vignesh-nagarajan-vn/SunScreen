"""SunScreen routing API. Run: uvicorn index:app --host 0.0.0.0 --port 8000

Every endpoint is served at /x and /api/x, so the same app runs locally and as a Vercel function.
"""
import json
import math
import os
import pickle
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Literal

import networkx as nx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# Also support the documented `cd api && uvicorn index:app` local entrypoint.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from campus_routing.passages import add_passages, load_catalog, traversal_available
from campus_routing.geometry import route_key
from api.lighting import routes as lighting_routes
from campus_routing.places import load_places, public_place, resolve_place, search_places
from campus_routing.indoors import is_room_query, load_destinations, room_available, room_guidance
from campus_routing.candidates import passage_candidates

WALK_MPS = 1.4
ALPHAS = [0, 0.25, 0.5, 1, 2, 4, 8, 16]  # shade weights tried when generating candidate routes
MAX_SNAP_M = 250  # points farther than this from any walkway are rejected
TZ = ZoneInfo("America/Chicago")
WEATHER_URL = (
    "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
    "&hourly=cloud_cover,direct_normal_irradiance_instant&timezone=America%2FChicago"
    "&start_date={date}&end_date={date}"
)
NOMINATIM = "https://nominatim.openstreetmap.org/search"

GRAPH = Path(os.environ.get("GRAPH_PATH", Path(__file__).resolve().parents[1] / "data" / "graph.pkl"))
with open(GRAPH, "rb") as f:
    G = pickle.load(f)
SLOTS = G.graph["slots"]  # ["0700", "0730", ...]
SUN = G.graph["sun"]  # slot -> altitude, azimuth, clearsky_dni
SHADOW_DATE = G.graph["date"]  # shade masks were cast for this date
PLACES = {p["id"]: p for p in load_places(G)}
PLACES.update({p['id']: p for p in load_destinations(G)})
DEFAULT = G.graph["default"]
B = G.graph["bounds"]
NODES = [(n, d["y"], d["x"]) for n, d in G.nodes(data=True)]
CENTER_LAT = (B["south"] + B["north"]) / 2
PASSAGES = load_catalog()


@lru_cache(maxsize=4)
def compiled_network(base, catalog_json, departure_iso):
    graph, records = add_passages(base, json.loads(catalog_json), datetime.fromisoformat(departure_iso))
    nx.freeze(graph)
    return graph, records

app = FastAPI(title="SunScreen")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
router = APIRouter()


def metres(lat1, lon1, lat2, lon2):
    dx = (lon2 - lon1) * 111_320 * math.cos(math.radians(CENTER_LAT))
    return math.hypot(dx, (lat2 - lat1) * 110_540)


def nearest_node(lat, lon):
    node, nlat, nlon = min(NODES, key=lambda n: metres(lat, lon, n[1], n[2]))
    return node, metres(lat, lon, nlat, nlon)


# ---- weather ------------------------------------------------------------------
_weather, _weather_failed_at = {}, 0.0


def hourly_weather(day):
    """Open-Meteo hourly forecast for one day; cached for 30 min, retried 5 min after a failure."""
    global _weather_failed_at
    cached = _weather.get(day)
    if cached and time.time() - cached[0] < 1800:
        return cached[1]
    if time.time() - _weather_failed_at < 300:
        raise RuntimeError("Open-Meteo failed recently")
    try:
        url = WEATHER_URL.format(lat=CENTER_LAT, lon=(B["west"] + B["east"]) / 2, date=day)
        with urllib.request.urlopen(url, timeout=5) as r:
            hourly = json.load(r)["hourly"]
    except Exception:
        _weather_failed_at = time.time()
        raise
    _weather[day] = (time.time(), hourly)
    return hourly


def weather_at(slot):
    """Cloud cover and sun strength (forecast / clear-sky direct beam) at a slot, for today."""
    sun = SUN[slot]
    if sun["altitude"] <= 0 or sun["clearsky_dni"] < 20:
        return {"source": "sun down", "cloud_cover_pct": None, "sun_strength_pct": 0}
    day = datetime.now(TZ).date().isoformat()
    try:
        w = hourly_weather(day)
        h, frac = int(slot[:2]), int(slot[2:]) / 60
        def lerp(key):
            a, b = w[key][h], w[key][min(h + 1, 23)]
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (a, b)):
                raise ValueError('Missing forecast values')
            return a * (1 - frac) + b * frac
        dni, clouds = lerp('direct_normal_irradiance_instant'), lerp('cloud_cover')
        if dni < 0 or not 0 <= clouds <= 100:
            raise ValueError('Forecast values out of range')
        strength = min(1.0, max(0.0, dni / sun['clearsky_dni']))
    except Exception as e:  # say so plainly and fall back to clear sky
        print(f"weather unavailable ({e}); assuming clear sky")
        return {"source": "unavailable, assuming clear sky", "cloud_cover_pct": None, "sun_strength_pct": 100}
    return {"source": "open-meteo", "date": day, "cloud_cover_pct": round(clouds),
            "sun_strength_pct": round(100 * strength)}


# ---- routing ------------------------------------------------------------------
def nearest_slot(hhmm):
    try:
        h, m = map(int, hhmm.split(":"))
        if not 0 <= h <= 23 or not 0 <= m <= 59:
            raise ValueError('Invalid clock time')
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, 'Time must be a valid 24-hour HH:MM value.')
    minutes = lambda s: int(s[:2]) * 60 + int(s[2:])
    return min(SLOTS, key=lambda s: (abs(minutes(s) - (h * 60 + m)), -minutes(s)))


def endpoint(value, label):
    """A place id or "lat,lon" -> {name, lat, lon, node}."""
    p = PLACES.get(value) or resolve_place(PLACES.values(), value)
    if p is not None:
        return {**public_place(p), 'node': p['node'], **({'_indoor_rule': p['_indoor_rule']} if '_indoor_rule' in p else {})}
    if is_room_query(value):
        raise HTTPException(400, "Indoor directions aren't mapped for this room yet. Search the building name for an outdoor route.")
    try:
        lat, lon = (float(v) for v in value.split(","))
    except ValueError:
        raise HTTPException(400, f"Unknown place '{value}'. Use a place id from /places or 'lat,lon'.")
    if not (B["south"] <= lat <= B["north"] and B["west"] <= lon <= B["east"]):
        raise HTTPException(400, f"{label} is outside the Texas A&M area SunScreen covers.")
    node, snap = nearest_node(lat, lon)
    if snap > MAX_SNAP_M:
        raise HTTPException(400, f"{label} is {snap:.0f} m from the nearest walkway.")
    return {"id": None, "name": label, "lat": lat, "lon": lon, "node": node}


def shortest(src, dst, i, alpha, graph=None, excluded_passage=None):
    graph = G if graph is None else graph
    cost = lambda d: d["length"] * (1 + alpha * (1 - d["shade"][i]))
    weight = (lambda u, v, ds: min((cost(d) for d in ds.values() if d.get('passage_id') != excluded_passage), default=None)) if excluded_passage else (lambda u, v, ds: min(map(cost, ds.values())))
    _, path = nx.bidirectional_dijkstra(graph, src, dst, weight=weight)
    return summarize_path(path, graph, i, alpha, excluded_passage=excluded_passage)


def summarize_path(path, graph, i, alpha, passage_id=None, excluded_passage=None):
    src, dst = path[0], path[-1]
    cost = lambda d: d['length'] * (1 + alpha * (1 - d['shade'][i]))
    coords, runs, length, shaded = [], [], 0.0, 0.0
    building_runs, indoor_m, covered_m = [], 0.0, 0.0
    for u, v in zip(path, path[1:]):
        eligible = [d for d in graph[u][v].values() if (passage_id is None or d.get('passage_id') == passage_id)
                    and (excluded_passage is None or d.get('passage_id') != excluded_passage)]
        d = min(eligible, key=cost)
        first = max(len(coords) - 1, 0)
        coords += d["coords"] if not coords else d["coords"][1:]
        runs.append([first, len(coords) - 1, round(d["shade"][i], 2)])  # coord range + shade of this edge
        length += d["length"]
        shaded += d["length"] * d["shade"][i]
        if d.get("passage_id"):
            indoor_m += d["length"] if d["environment"] == "indoor" else 0
            covered_m += d["length"] if d["environment"] == "covered" else 0
            building_runs.append({"first": first, "last": len(coords) - 1,
                                  "building": d["building"], "environment": d["environment"],
                                  "passage_id": d["passage_id"], "access_status": d.get("access_status", "unconfirmed"),
                                  "access_unconfirmed": d.get('access_unconfirmed', False),
                                  "start_m": length - d["length"], "end_m": length})
    if not coords:  # both ends snapped to the same node
        n = graph.nodes[src]
        coords = [[n["x"], n["y"]]]
    # Original edges were rounded to six decimals; corridor endpoints were not.
    # All variants must meet at exactly the same mapped nodes.
    coords[0] = [graph.nodes[src]['x'], graph.nodes[src]['y']]
    coords[-1] = [graph.nodes[dst]['x'], graph.nodes[dst]['y']]
    return {"path": tuple(path), "route_key": route_key(coords), "coords": coords, "runs": runs, "length": length,
            "shade": shaded / length if length else 1.0, "indoor_m": indoor_m,
            "covered_passage_m": covered_m, "building_runs": building_runs}


def extra(seconds):
    return f"+{seconds} s" if seconds < 60 else f"+{seconds / 60:.1f} min"


def departure_for_slot(slot):
    return datetime.now(TZ).replace(hour=int(slot[:2]), minute=int(slot[2:]), second=0, microsecond=0)


def feature(route_id, label, r, fastest, sun):
    minutes = r["length"] / WALK_MPS / 60
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": r["coords"]},
        "properties": {
            "id": route_id,
            "label": label,
            "distance_m": round(r["length"]),
            "time_min": round(minutes, 1),
            "extra_s": round((r["length"] - fastest["length"]) / WALK_MPS),
            "shaded_pct": round(100 * r["shade"]),
            "sun_min": round(minutes * (1 - r["shade"]) * sun, 1),  # minutes in direct sun
            "same_as_fastest": r["route_key"] == fastest["route_key"],
            "runs": r["runs"],  # [first coord, last coord, shade 0-1] per edge, for sun/shade coloring
            "indoor_m": round(r["indoor_m"], 1),
            "covered_passage_m": round(r["covered_passage_m"], 1),
            "building_runs": r["building_runs"],
            "via_buildings": list(dict.fromkeys(run["building"] for run in r["building_runs"])),
            "access_unconfirmed": any(run['access_status'] == 'unconfirmed' or run.get('access_unconfirmed', False) for run in r['building_runs']),
        },
    }


def route(time="14:00", src=None, dst=None, src_name="Start", dst_name="Destination", mode="shade",
          recommended_pct=10, max_detour_pct=30):
    for value in (recommended_pct, max_detour_pct):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
            raise HTTPException(400, "Route distance allowances must be between 0% and 100%.")
    if recommended_pct > max_detour_pct:
        raise HTTPException(400, "The maximum route allowance must be at least the Recommended allowance.")
    limits = {"recommended_pct": recommended_pct, "max_detour_pct": max_detour_pct,
              "effective_recommended_pct": recommended_pct}
    a = endpoint(src or DEFAULT[0], src_name)
    b = endpoint(dst or DEFAULT[1], dst_name)
    if (a.get('indoor') and a['building_id'] == b['id']) or (b.get('indoor') and b['building_id'] == a['id']):
        raise HTTPException(400, 'You are already in the destination building. Use the indoor directions; no outdoor trip is needed.')
    if a["node"] == b["node"]:
        if a['id'] and b['id'] and a['id'] != b['id']:
            raise HTTPException(400, "These buildings share the same mapped walkway point. Try adjusting a pin on the map.")
        raise HTTPException(400, "Start and destination are the same spot.")
    if mode not in ("shade", "lighting"):
        raise HTTPException(400, "Unknown routing mode")
    room_departure = datetime.now(TZ) if mode == 'lighting' else departure_for_slot(nearest_slot(time))
    if not room_available(a, room_departure):
        raise HTTPException(400, 'The starting building is closed at this departure time. Choose an outdoor start.')
    def indoor_response(features):
        if not room_guidance(a, b):
            return {}
        if any(not room_available(b, room_departure + timedelta(minutes=f['properties']['time_min'])) for f in features):
            raise HTTPException(400, 'The destination building will be closed at the estimated arrival time. Choose another time or an outdoor destination.')
        return {'indoor_guidance': room_guidance(a, b), 'walking_estimate_scope': 'outdoor_to_entrance'}
    if mode == "lighting":
        try:
            features, summary, status = lighting_routes(G, a["node"], b["node"], WALK_MPS,
                                                        recommended_pct / 100, max_detour_pct / 100)
        except nx.NetworkXNoPath:
            raise HTTPException(400, "No walking path connects those two points.")
        pick = lambda e: {k: e[k] for k in ("id", "name", "lat", "lon")}
        return {"type": "FeatureCollection", "mode": "lighting", "features": features,
                "route_limits": limits,
                "summary": summary, "lighting_status": status,
                "lighting": G.graph.get("lighting", {"source": "OpenStreetMap", "retrieved_at": None}),
                "start": pick(a), "end": pick(b), **indoor_response(features)}
    slot = nearest_slot(time)
    i = SLOTS.index(slot)
    weather = weather_at(slot)
    sun = weather["sun_strength_pct"] / 100
    departure = departure_for_slot(slot)
    try:
        graph, available = compiled_network(G, json.dumps(PASSAGES, sort_keys=True), departure.isoformat())
    except (ValueError, KeyError, TypeError) as exc:
        print(f"Building passages unavailable: {exc}; using outdoor graph")
        graph, available = G, []

    candidates = []
    for network in (G, graph) if available else (G,):
        try:
            paths = [shortest(a['node'], b['node'], i, alpha, network) for alpha in ALPHAS]
            candidates.extend(path for path in paths if traversal_available(path, network, departure, WALK_MPS))
        except nx.NetworkXNoPath:
            # A building may connect components that were disconnected outdoors.
            continue
    if not candidates:
        raise HTTPException(400, "No walking path connects those two points.")
    fastest = min(candidates, key=lambda candidate: candidate["length"])
    max_distance = fastest['length'] * (1 + max_detour_pct / 100)
    considered = {run['passage_id'] for c in candidates if c['length'] <= max_distance for run in c['building_runs']}
    rules = [rule for rule in graph.graph.get('passage_rules', {}).values() if rule.get('doors') and rule['id'] not in considered]
    if rules:
        evaluated = passage_candidates(graph, rules, a['node'], b['node'], i, ALPHAS,
                                        max_distance, shortest, summarize_path)
        candidates.extend(r for r in evaluated if traversal_available(r, graph, departure, WALK_MPS))
        fastest = min(candidates, key=lambda candidate: candidate['length'])
    best = lambda limit: max(
        (c for c in candidates if c["length"] <= limit), key=lambda c: (round(c["shade"], 3), -c["length"])
    )
    limits['effective_recommended_pct'] = round(recommended_pct * sun, 4)
    recommended = best(fastest["length"] * (1 + recommended_pct / 100 * sun))
    max_shade = best(fastest["length"] * (1 + max_detour_pct / 100))

    features = [
        feature("fastest", "Fastest", fastest, fastest, sun),
        feature("recommended", "Recommended", recommended, fastest, sun),
        feature("max_shade", "Max shade", max_shade, fastest, sun),
    ]
    features[2]["properties"]["same_as_recommended"] = max_shade["route_key"] == recommended["route_key"]
    f, r = features[0]["properties"], features[1]["properties"]
    if sun == 0:
        note = "Direct sunlight is low. The fastest route is a good choice."
    elif sun < 0.25:
        note = "Heavy clouds are blocking the sun, so shade barely matters."
    elif r["same_as_fastest"]:
        note = "The fastest route is already the best shade trade-off."
    else:
        note = f"Recommended: {extra(r['extra_s'])}, {f['shaded_pct']}% → {r['shaded_pct']}% shaded"
    pick = lambda e: {k: e[k] for k in ("id", "name", "lat", "lon")}
    return {
        "type": "FeatureCollection",
        "mode": "shade",
        "route_limits": limits,
        "features": features,
        "shadow_date": SHADOW_DATE,
        "time": f"{slot[:2]}:{slot[2:]}",
        "sun": {"altitude": SUN[slot]["altitude"], "azimuth": SUN[slot]["azimuth"]},
        "weather": weather,
        "summary": note,
        "start": pick(a),
        "end": pick(b),
        **indoor_response(features),
        "building_routing": {
            "available_passages": [p["id"] for p in available],
            "excluded_count": len(graph.graph.get('passage_diagnostics', [])),
            "verification": "Map-derived passages; exact geometry and current access remain unverified.",
        },
    }


def places():
    return {"bounds": B, "default": DEFAULT,
            "places": [public_place(p) for p in PLACES.values()]}


_search = {}


def search(q):
    """Known campus codes/names resolve offline; other addresses use Nominatim."""
    local = search_places(PLACES.values(), q)
    if local:
        return {"results": [public_place(p) for p in local]}
    if is_room_query(q):
        return {'results': [], 'message': "Indoor directions aren't mapped for this room yet. Search the building name for an outdoor route."}
    if not q.strip():
        return {"results": []}
    key = q.strip().lower()
    if key not in _search:
        params = urllib.parse.urlencode({
            "q": q, "format": "jsonv2", "limit": 6, "bounded": 1,
            "viewbox": f"{B['west']},{B['north']},{B['east']},{B['south']}",
        })
        req = urllib.request.Request(f"{NOMINATIM}?{params}", headers={"User-Agent": "SunScreen/1.0 (Howdy Hacks 2026)"})
        try:
            with urllib.request.urlopen(req, timeout=6) as r:
                hits = json.load(r)
        except Exception as e:
            raise HTTPException(502, f"Search is unavailable right now ({e.__class__.__name__}).")
        _search[key] = [{"name": h.get("name") or h["display_name"].split(",")[0], "lat": float(h["lat"]),
                         "lon": float(h["lon"])} for h in hits]
    return {"results": _search[key]}


@router.get("/route")
def get_route(
    time: str = Query("14:00", pattern=r"^\d{1,2}:\d{2}$"),
    from_: str = Query(None, alias="from", description="place id or lat,lon"),
    to: str = Query(None, description="place id or lat,lon"),
    from_name: str = Query("Start", max_length=80),
    to_name: str = Query("Destination", max_length=80),
    mode: Literal["shade", "lighting"] = "shade",
    recommended_pct: float = Query(10, ge=0, le=100, allow_inf_nan=False),
    max_detour_pct: float = Query(30, ge=0, le=100, allow_inf_nan=False),
):
    return route(time, from_, to, from_name, to_name, mode, recommended_pct, max_detour_pct)


@router.get("/building-passages")
def get_building_passages():
    return PASSAGES


@router.get('/building-entrances')
def get_building_entrances():
    try:
        return json.loads(GRAPH.with_name('building_entrances.json').read_text(encoding='utf-8'))
    except (OSError, ValueError, UnicodeError):
        return {'buildings': [], 'limitations': 'Entrance inventory is unavailable.'}


@router.get("/places")
def get_places():
    return places()


@router.get("/search")
def get_search(q: str = Query(..., min_length=2, max_length=80)):
    return search(q)


app.include_router(router)
app.include_router(router, prefix="/api")
