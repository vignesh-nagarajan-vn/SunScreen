"""Walk graph for the bbox with per-edge shade fraction per slot.

Writes data/graph.geojson (WGS84, one LineString per edge with shade_HHMM in 0-1)
and data/graph.pkl (a plain networkx graph the API loads).
"""
import json
import pickle
from pathlib import Path

import networkx as nx
import numpy as np
import osmnx as ox
import rasterio
import shapely
from pyproj import Transformer

DATA = Path(__file__).resolve().parents[1] / "data"
STEP_M = 2.0

area = json.loads((DATA / "area.json").read_text())
crs = area["crs"]
slots = list(json.loads((DATA / "shade" / "sun.json").read_text())["slots"])

G = ox.graph_from_bbox(tuple(area["bbox_wgs84"]), network_type="walk")
Gp = ox.project_graph(G, to_crs=crs)
edges = ox.graph_to_gdfs(Gp, nodes=False)
print(f"walk graph: {len(G.nodes):,} nodes, {len(G.edges):,} edges")

# Sample every 2 m along each edge (plus its end point).
lengths = edges.geometry.length.to_numpy()
counts = np.floor(lengths / STEP_M).astype(int) + 2
edge_idx = np.repeat(np.arange(len(edges)), counts)
starts = np.repeat(np.cumsum(counts) - counts, counts)
dist = np.minimum((np.arange(len(edge_idx)) - starts) * STEP_M, lengths[edge_idx])
pts = shapely.line_interpolate_point(edges.geometry.to_numpy()[edge_idx], dist)
xs, ys = shapely.get_x(pts), shapely.get_y(pts)

masks = []
for slot in slots:
    with rasterio.open(DATA / "shade" / f"shade_{slot}.tif") as src:
        masks.append(src.read(1))
        transform, (h, w) = src.transform, src.shape
masks = np.stack(masks)  # (slots, rows, cols)
rows, cols = rasterio.transform.rowcol(transform, xs, ys)
rows, cols = np.clip(rows, 0, h - 1), np.clip(cols, 0, w - 1)
samples = masks[:, rows, cols].astype(float)  # (slots, points)
n = np.bincount(edge_idx)
shade = np.stack([np.bincount(edge_idx, weights=s) / n for s in samples], axis=1)  # (edges, slots)

# Lean graph for the API: lon/lat nodes, edges with length, coords (u -> v) and shade per slot.
to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
out = nx.MultiDiGraph(slots=slots)
for node, d in G.nodes(data=True):
    out.add_node(node, x=d["x"], y=d["y"])
for i, ((u, v, k), geom) in enumerate(edges.geometry.items()):
    lon, lat = to_wgs.transform(*np.asarray(geom.coords).T)
    coords = [[round(a, 6), round(b, 6)] for a, b in zip(lon, lat)]
    if np.hypot(coords[0][0] - G.nodes[u]["x"], coords[0][1] - G.nodes[u]["y"]) > \
       np.hypot(coords[-1][0] - G.nodes[u]["x"], coords[-1][1] - G.nodes[u]["y"]):
        coords.reverse()
    out.add_edge(int(u), int(v), int(k), length=float(lengths[i]), coords=coords, shade=shade[i].round(3))

to_utm = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
for name in ("start", "end"):
    x, y = to_utm.transform(area[name]["lon"], area[name]["lat"])
    node = ox.distance.nearest_nodes(Gp, x, y)
    snap = np.hypot(Gp.nodes[node]["x"] - x, Gp.nodes[node]["y"] - y)
    out.graph[name] = {**area[name], "node": int(node)}
    print(f"{name} snapped to node {node} ({snap:.0f} m away)")

with open(DATA / "graph.pkl", "wb") as f:
    pickle.dump(out, f)

features = [
    {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": d["coords"]},
        "properties": {"u": u, "v": v, "key": k, "length": round(d["length"], 1),
                       **{f"shade_{s}": round(float(x), 2) for s, x in zip(slots, d["shade"])}},
    }
    for u, v, k, d in out.edges(keys=True, data=True)
]
(DATA / "graph.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))
mid = slots.index("1400") if "1400" in slots else len(slots) // 2
print(f"mean edge shade at {slots[mid]}: {shade[:, mid].mean():.0%}")
print(f"wrote graph.geojson ({len(features):,} edges) and graph.pkl")
