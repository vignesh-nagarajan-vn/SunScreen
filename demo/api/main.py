"""Shade-aware routing API. Run: uvicorn main:app --host 0.0.0.0 --port 8000"""
import pickle
from pathlib import Path

import networkx as nx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

WALK_MPS = 1.4

with open(Path(__file__).resolve().parents[1] / "data" / "graph.pkl", "rb") as f:
    G = pickle.load(f)
SLOTS = G.graph["slots"]  # ["0700", "0730", ...]
START, END = G.graph["start"], G.graph["end"]

app = FastAPI(title="Shade routes")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def nearest_slot(hhmm):
    h, m = map(int, hhmm.split(":"))
    minutes = lambda s: int(s[:2]) * 60 + int(s[2:])
    return min(range(len(SLOTS)), key=lambda i: abs(minutes(SLOTS[i]) - (h * 60 + m)))


def shortest(slot, alpha):
    cost = lambda d: d["length"] * (1 + alpha * (1 - d["shade"][slot]))
    path = nx.shortest_path(G, START["node"], END["node"], weight=lambda u, v, ds: min(map(cost, ds.values())))
    coords, length, shaded = [], 0.0, 0.0
    for u, v in zip(path, path[1:]):
        d = min(G[u][v].values(), key=cost)
        coords += d["coords"] if not coords else d["coords"][1:]
        length += d["length"]
        shaded += d["length"] * d["shade"][slot]
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {
            "distance_m": round(length),
            "time_min": round(length / WALK_MPS / 60, 1),
            "shaded_pct": round(100 * shaded / length) if length else 0,
        },
    }


def route(time="14:00", alpha=1.0):
    slot = nearest_slot(time)
    fastest, shadiest = shortest(slot, 0.0), shortest(slot, alpha)
    fastest["properties"]["name"], shadiest["properties"]["name"] = "fastest", "shadiest"
    f, s = fastest["properties"], shadiest["properties"]
    extra = round(s["time_min"] - f["time_min"])
    return {
        "type": "FeatureCollection",
        "features": [fastest, shadiest],
        "time": f"{SLOTS[slot][:2]}:{SLOTS[slot][2:]}",
        "alpha": alpha,
        "summary": f"{extra:+d} min, {f['shaded_pct']}% → {s['shaded_pct']}% shaded",
        "start": {k: START[k] for k in ("name", "lat", "lon")},
        "end": {k: END[k] for k in ("name", "lat", "lon")},
    }


@app.get("/route")
def get_route(time: str = Query("14:00", pattern=r"^\d{1,2}:\d{2}$"), alpha: float = Query(1.0, ge=0, le=1)):
    return route(time, alpha)
