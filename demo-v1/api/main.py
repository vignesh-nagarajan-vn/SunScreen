"""Shade-aware routing API. Run: uvicorn main:app --host 0.0.0.0 --port 8000"""
import json
import pickle
import time
import urllib.request
from pathlib import Path

import networkx as nx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

WALK_MPS = 1.4
ALPHAS = [0, 0.5, 1, 2, 4, 8]  # shade weights tried when generating candidate routes
RECOMMENDED_DETOUR = 0.10  # up to +10% distance in full sun, scaled down by clouds
MAX_SHADE_DETOUR = 0.30  # "max shade" may be up to 30% longer than the fastest route
WEATHER_URL = (
    "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
    "&hourly=cloud_cover,direct_normal_irradiance_instant&timezone=America%2FChicago"
    "&start_date={date}&end_date={date}"
)

with open(Path(__file__).resolve().parents[1] / "data" / "graph.pkl", "rb") as f:
    G = pickle.load(f)
SLOTS = G.graph["slots"]  # ["0700", "0730", ...]
SUN = G.graph["sun"]  # slot -> altitude, azimuth, clearsky_dni
DATE = G.graph["date"]  # shade masks were cast for this date
START, END = G.graph["start"], G.graph["end"]

app = FastAPI(title="SunScreen")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_weather = {}
_weather_failed_at = 0.0


def hourly_weather():
    """Open-Meteo hourly forecast for DATE; cached after the first success, retried every 5 min."""
    global _weather_failed_at
    if not _weather:
        if time.time() - _weather_failed_at < 300:
            raise RuntimeError("Open-Meteo failed recently")
        try:
            url = WEATHER_URL.format(lat=START["lat"], lon=START["lon"], date=DATE)
            with urllib.request.urlopen(url, timeout=5) as r:
                _weather.update(json.load(r)["hourly"])
        except Exception:
            _weather_failed_at = time.time()
            raise
    return _weather


def weather_at(slot):
    """Cloud cover and sun strength (forecast / clear-sky direct beam) at a slot."""
    sun = SUN[slot]
    if sun["altitude"] <= 0 or sun["clearsky_dni"] < 20:
        return {"source": "sun down", "cloud_cover_pct": None, "sun_strength_pct": 0}
    try:
        w = hourly_weather()
    except Exception as e:  # say so plainly and fall back to clear sky
        print(f"weather unavailable ({e}); assuming clear sky")
        return {"source": "unavailable, assuming clear sky", "cloud_cover_pct": None, "sun_strength_pct": 100}
    # Interpolate hourly values to the half-hour slot.
    h, frac = int(slot[:2]), int(slot[2:]) / 60
    lerp = lambda key: w[key][h] * (1 - frac) + w[key][min(h + 1, 23)] * frac
    strength = min(1.0, max(0.0, lerp("direct_normal_irradiance_instant") / sun["clearsky_dni"]))
    return {"source": "open-meteo", "cloud_cover_pct": round(lerp("cloud_cover")), "sun_strength_pct": round(100 * strength)}


def nearest_slot(hhmm):
    h, m = map(int, hhmm.split(":"))
    minutes = lambda s: int(s[:2]) * 60 + int(s[2:])
    return min(SLOTS, key=lambda s: abs(minutes(s) - (h * 60 + m)))


def shortest(i, alpha):
    cost = lambda d: d["length"] * (1 + alpha * (1 - d["shade"][i]))
    path = nx.shortest_path(G, START["node"], END["node"], weight=lambda u, v, ds: min(map(cost, ds.values())))
    coords, length, shaded = [], 0.0, 0.0
    for u, v in zip(path, path[1:]):
        d = min(G[u][v].values(), key=cost)
        coords += d["coords"] if not coords else d["coords"][1:]
        length += d["length"]
        shaded += d["length"] * d["shade"][i]
    return {"path": tuple(path), "coords": coords, "length": length, "shade": shaded / length if length else 0}


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
        },
    }


def route(time="14:00"):
    slot = nearest_slot(time)
    i = SLOTS.index(slot)
    weather = weather_at(slot)
    sun = weather["sun_strength_pct"] / 100

    candidates = [shortest(i, a) for a in ALPHAS]
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
    f, r = features[0]["properties"], features[1]["properties"]
    if sun == 0:
        note = "Sun is down, so every route is in shade. Take the fastest."
    elif sun < 0.25:
        note = "Heavy clouds are blocking the sun, so shade barely matters."
    elif r["same_as_fastest"]:
        note = "The fastest route is already the best shade trade-off."
    else:
        note = f"Recommended: {extra(r['extra_s'])}, {f['shaded_pct']}% → {r['shaded_pct']}% shaded"
    return {
        "type": "FeatureCollection",
        "features": features,
        "date": DATE,
        "time": f"{slot[:2]}:{slot[2:]}",
        "sun": {"altitude": SUN[slot]["altitude"], "azimuth": SUN[slot]["azimuth"]},
        "weather": weather,
        "summary": note,
        "start": {k: START[k] for k in ("name", "lat", "lon")},
        "end": {k: END[k] for k in ("name", "lat", "lon")},
    }


@app.get("/route")
def get_route(time: str = Query("14:00", pattern=r"^\d{1,2}:\d{2}$")):
    return route(time)
