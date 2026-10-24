"""Lighting-only route scoring. No shade, sun position, or weather dependencies."""
import math

import networkx as nx

ALPHAS = (0, 0.25, 0.5, 1, 2, 4, 8, 16)
PENALTIES = {"mapped": 0.0, "estimated": 0.2, "unknown": 0.5, "conflict": 0.6, "unlit": 1.0}
MIN_EVIDENCE = 0.10  # Below this route coverage, retain the fastest route.


def evidence(edge):
    return edge.get("lighting") or {"unknown": 1.0, "runs": [[0, 1, "unknown"]]}


def risk(edge):
    return sum(evidence(edge).get(state, 0) * penalty for state, penalty in PENALTIES.items())


def slice_line(coords, start, end):
    """Cut a directed geographic polyline by normalized metric distance."""
    lat = sum(p[1] for p in coords) / len(coords)
    scale = math.cos(math.radians(lat))
    lengths = [math.hypot((b[0] - a[0]) * 111320 * scale, (b[1] - a[1]) * 110540)
               for a, b in zip(coords, coords[1:])]
    total = sum(lengths)
    lo, hi, offset, result = start * total, end * total, 0.0, []
    for a, b, length in zip(coords, coords[1:], lengths):
        if length and offset <= hi and offset + length >= lo:
            t0 = max(0, (lo - offset) / length)
            t1 = min(1, (hi - offset) / length)
            for t in (t0, t1):
                p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
                if not result or result[-1] != p:
                    result.append(p)
        offset += length
    return result if len(result) >= 2 else [coords[0], coords[-1]]


def shortest(graph, src, dst, alpha):
    cost = lambda edge: edge["length"] * (1 + alpha * risk(edge))
    _, path = nx.bidirectional_dijkstra(graph, src, dst,
        weight=lambda u, v, edges: min(cost(d) for d in edges.values()))
    totals = {state: 0.0 for state in PENALTIES}
    coords, runs, signature = [], [], []
    length = risk_m = gap = longest_gap = 0.0
    for u, v in zip(path, path[1:]):
        key, edge = min(graph[u][v].items(), key=lambda item: cost(item[1]))
        signature.append((u, v, key))
        coords.extend(edge["coords"] if not coords else edge["coords"][1:])
        length += edge["length"]
        risk_m += edge["length"] * risk(edge)
        lighting = evidence(edge)
        for state in totals:
            totals[state] += edge["length"] * lighting.get(state, 0)
        for start, end, state in lighting.get("runs", [[0, 1, "unknown"]]):
            runs.append({"coordinates": slice_line(edge["coords"], start, end), "state": state})
            if state in ("unknown", "unlit", "conflict"):
                gap += (end - start) * edge["length"]
                longest_gap = max(longest_gap, gap)
            else:
                gap = 0
    return {"path": tuple(signature), "coords": coords, "length": length, "runs": runs,
            "totals": totals, "risk_m": risk_m, "longest_gap_m": longest_gap}


def routes(graph, src, dst, walk_mps, recommended_detour=0.10, max_detour=0.30):
    candidates = [shortest(graph, src, dst, alpha) for alpha in ALPHAS]
    fastest = candidates[0]
    def bounded(detour):
        return [c for c in candidates if c["length"] <= fastest["length"] * (1 + detour) + 1e-6]
    usable = bounded(max_detour)
    coverage = lambda c: (c["totals"]["mapped"] + c["totals"]["estimated"] + c["totals"]["unlit"]) / max(c["length"], 1)
    insufficient = max(map(coverage, usable)) < MIN_EVIDENCE
    def best(detour):
        return fastest if insufficient else min(bounded(detour), key=lambda c: (round(c["risk_m"], 3), c["length"]))
    recommended, most_lit = best(recommended_detour), best(max_detour)
    features = []
    for route_id, label, route in (("fastest", "Fastest", fastest), ("recommended", "Recommended", recommended), ("max_lit", "Most lit", most_lit)):
        total = max(route["length"], 1)
        pct = lambda state: round(100 * route["totals"][state] / total)
        p = {"id": route_id, "label": label, "mode": "lighting",
             "distance_m": round(route["length"]), "time_min": round(route["length"] / walk_mps / 60, 1),
             "extra_s": round((route["length"] - fastest["length"]) / walk_mps),
             "mapped_lit_pct": pct("mapped"), "estimated_lit_pct": pct("estimated"),
             "lit_pct": round(100 * (route["totals"]["mapped"] + route["totals"]["estimated"]) / total),
             "unlit_pct": pct("unlit"), "unknown_pct": pct("unknown"), "conflict_pct": pct("conflict"),
             "longest_uncertain_gap_m": round(route["longest_gap_m"]),
             "lighting_status": "insufficient_data" if insufficient else "limited" if coverage(route) < 0.5 else "available",
             "same_as_fastest": route["path"] == fastest["path"], "lighting_runs": route["runs"]}
        if route_id == "max_lit":
            p["same_as_recommended"] = route["path"] == recommended["path"]
        features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": route["coords"]}, "properties": p})
    if insufficient:
        summary = "Not enough mapped lighting for this trip. Showing the fastest walking route."
    elif recommended["path"] == fastest["path"]:
        summary = "The fastest route is already the best lighting trade-off in the mapped data."
    else:
        summary = f"Recommended: {features[1]['properties']['lit_pct']}% mapped or estimated lit, +{features[1]['properties']['extra_s']} s walk."
    return features, summary, "insufficient_data" if insufficient else "available"
