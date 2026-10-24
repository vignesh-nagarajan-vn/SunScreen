"""SunScreen routing API. Run: uvicorn main:app --host 0.0.0.0 --port 8000

Every endpoint is served at /x and /api/x, so the same app runs locally and as a Vercel function.
"""
import json
import math
import os
import pickle
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import networkx as nx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

WALK_MPS = 1.4
ALPHAS = [0, 0.25, 0.5, 1, 2, 4, 8, 16]  # shade weights tried when generating candidate routes
RECOMMENDED_DETOUR = 0.10  # up to +10% distance in full sun, scaled down by clouds
MAX_SHADE_DETOUR = 0.30  # "max shade" may be up to 30% longer than the fastest route
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
PLACES = {p["id"]: p for p in G.graph["places"]}
DEFAULT = G.graph["default"]
B = G.graph["bounds"]
NODES = [(n, d["y"], d["x"]) for n, d in G.nodes(data=True)]
CENTER_LAT = (B["south"] + B["north"]) / 2

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
    except Exception as e:  # say so plainly and fall back to clear sky
        print(f"weather unavailable ({e}); assuming clear sky")
        return {"source": "unavailable, assuming clear sky", "cloud_cover_pct": None, "sun_strength_pct": 100}
    # Interpolate hourly values to the half-hour slot.
    h, frac = int(slot[:2]), int(slot[2:]) / 60
    lerp = lambda key: w[key][h] * (1 - frac) + w[key][min(h + 1, 23)] * frac
    strength = min(1.0, max(0.0, lerp("direct_normal_irradiance_instant") / sun["clearsky_dni"]))
    return {"source": "open-meteo", "date": day, "cloud_cover_pct": round(lerp("cloud_cover")),
            "sun_strength_pct": round(100 * strength)}


# ---- routing ------------------------------------------------------------------
def nearest_slot(hhmm):
    h, m = map(int, hhmm.split(":"))
    minutes = lambda s: int(s[:2]) * 60 + int(s[2:])
    return min(SLOTS, key=lambda s: abs(minutes(s) - (h * 60 + m)))


def endpoint(value, label):
    """A place id or "lat,lon" -> {name, lat, lon, node}."""
    if value in PLACES:
        p = PLACES[value]
        return {"id": p["id"], "name": p["name"], "lat": p["lat"], "lon": p["lon"], "node": p["node"]}
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


def shortest(src, dst, i, alpha):
    cost = lambda d: d["length"] * (1 + alpha * (1 - d["shade"][i]))
    _, path = nx.bidirectional_dijkstra(G, src, dst, weight=lambda u, v, ds: min(map(cost, ds.values())))
    coords, runs, length, shaded = [], [], 0.0, 0.0
    for u, v in zip(path, path[1:]):
        d = min(G[u][v].values(), key=cost)
        first = max(len(coords) - 1, 0)
        coords += d["coords"] if not coords else d["coords"][1:]
        runs.append([first, len(coords) - 1, round(d["shade"][i], 2)])  # coord range + shade of this edge
        length += d["length"]
        shaded += d["length"] * d["shade"][i]
    if not coords:  # both ends snapped to the same node
        n = G.nodes[src]
        coords = [[n["x"], n["y"]]]
    return {"path": tuple(path), "coords": coords, "runs": runs, "length": length,
            "shade": shaded / length if length else 1.0}


def extra(seconds):
    return f"+{seconds} s" if seconds < 60 else f"+{seconds / 60:.1f} min"


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
            "same_as_fastest": r["path"] == fastest["path"],
            "runs": r["runs"],  # [first coord, last coord, shade 0-1] per edge, for sun/shade coloring
        },
    }


def route(time="14:00", src=None, dst=None, src_name="Start", dst_name="Destination"):
    a = endpoint(src or DEFAULT[0], src_name)
    b = endpoint(dst or DEFAULT[1], dst_name)
    if a["node"] == b["node"]:
        raise HTTPException(400, "Start and destination are the same spot.")
    slot = nearest_slot(time)
    i = SLOTS.index(slot)
    weather = weather_at(slot)
    sun = weather["sun_strength_pct"] / 100

    try:
        candidates = [shortest(a["node"], b["node"], i, alpha) for alpha in ALPHAS]
    except nx.NetworkXNoPath:
        raise HTTPException(400, "No walking path connects those two points.")
    fastest = candidates[0]
    best = lambda limit: max(
        (c for c in candidates if c["length"] <= limit), key=lambda c: (round(c["shade"], 3), -c["length"])
    )
    recommended = best(fastest["length"] * (1 + RECOMMENDED_DETOUR * sun))
    max_shade = best(fastest["length"] * (1 + MAX_SHADE_DETOUR))

    features = [
        feature("fastest", "Fastest", fastest, fastest, sun),
        feature("recommended", "Recommended", recommended, fastest, sun),
        feature("max_shade", "Max shade", max_shade, fastest, sun),
    ]
    features[2]["properties"]["same_as_recommended"] = max_shade["path"] == recommended["path"]
    f, r = features[0]["properties"], features[1]["properties"]
    if sun == 0:
        note = "Sun is down, so every route is in shade. Take the fastest."
    elif sun < 0.25:
        note = "Heavy clouds are blocking the sun, so shade barely matters."
    elif r["same_as_fastest"]:
        note = "The fastest route is already the best shade trade-off."
    else:
        note = f"Recommended: {extra(r['extra_s'])}, {f['shaded_pct']}% → {r['shaded_pct']}% shaded"
    pick = lambda e: {k: e[k] for k in ("id", "name", "lat", "lon")}
    return {
        "type": "FeatureCollection",
        "features": features,
        "shadow_date": SHADOW_DATE,
        "time": f"{slot[:2]}:{slot[2:]}",
        "sun": {"altitude": SUN[slot]["altitude"], "azimuth": SUN[slot]["azimuth"]},
        "weather": weather,
        "summary": note,
        "start": pick(a),
        "end": pick(b),
    }


def places():
    return {"bounds": B, "default": DEFAULT,
            "places": [{k: p.get(k) for k in ("id", "name", "category", "lat", "lon")} for p in PLACES.values()]}


_search = {}


def search(q):
    """Nominatim search limited to the campus box (cached; Nominatim allows ~1 request/s)."""
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
):
    return route(time, from_, to, from_name, to_name)


@router.get("/places")
def get_places():
    return places()


@router.get("/search")
def get_search(q: str = Query(..., min_length=2, max_length=80)):
    return search(q)


app.include_router(router)
app.include_router(router, prefix="/api")
