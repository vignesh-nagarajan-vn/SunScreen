"""Offline campus names/codes and graph-connected destination loading."""
import json
import math
import re
import unicodedata
from pathlib import Path

import networkx as nx

from .geometry import metres

CATALOG = Path(__file__).resolve().parents[1] / 'data/campus_places.json'
PUBLIC_FIELDS = ('id', 'name', 'category', 'lat', 'lon', 'aliases', 'building_code', 'building_number')


def normalize(value):
    value = unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', value.replace('&', ' and ')).strip()


def terms(place):
    return [normalize(x) for x in [place['name'], place['id'].replace('_', ' '),
            place.get('building_code', ''), place.get('building_number', ''), *place.get('aliases', [])] if x]


def match_score(place, query):
    q = normalize(query)
    if not q:
        return None
    compact = q.replace(' ', '')
    names = terms(place)
    if any(t == q or len(compact) >= 2 and t.replace(' ', '') == compact for t in names):
        return 0
    if any(t.startswith(q) or len(compact) >= 2 and t.replace(' ', '').startswith(compact) for t in names):
        return 1
    if any(all(any(w.startswith(token) for w in t.split()) for token in q.split()) for t in names):
        return 2
    if any(q in t for t in names):
        return 3
    return None


def search_places(places, query, limit=40):
    scored = [(score, p) for p in places if (score := match_score(p, query)) is not None]
    scored.sort(key=lambda item: (item[0], normalize(item[1]['name']), item[1]['id']))
    return [p for _, p in scored[:limit]]


def resolve_place(places, query):
    matches = [p for p in places if match_score(p, query) == 0]
    return matches[0] if len(matches) == 1 else None


def public_place(place):
    return {key: place.get(key) for key in PUBLIC_FIELDS if place.get(key) is not None}


def attach_places(graph, records):
    """Retain legacy IDs/anchors; connect additions to the default trip's component.

    A graph rebuild can invalidate saved node IDs. Re-snap those additions rather
    than assuming an arbitrary graph node is the building's entrance.
    """
    legacy = {p['id']: dict(p) for p in graph.graph['places']}
    result = dict(legacy)
    bounds = graph.graph['bounds']
    anchor = legacy[graph.graph['default'][0]]['node']
    component = next(c for c in nx.strongly_connected_components(graph) if anchor in c)
    def within(point):
        return bounds['west'] - 0.00001 <= point[0] <= bounds['east'] + 0.00001 and bounds['south'] - 0.00001 <= point[1] <= bounds['north'] + 0.00001
    # OSM boundary edges can briefly leave the shadow raster. Do not preload a
    # destination whose only mapped approach requires that uncovered boundary.
    bounded = nx.subgraph_view(graph,
        filter_node=lambda n: within([graph.nodes[n]['x'], graph.nodes[n]['y']]),
        filter_edge=lambda u, v, k: all(within(c) for c in graph[u][v][k]['coords']))
    covered_component = next(c for c in nx.strongly_connected_components(bounded) if anchor in c)
    nodes = [(n, [graph.nodes[n]['x'], graph.nodes[n]['y']]) for n in component]
    errors, seen = [], set()
    for record in records:
        try:
            pid = record['id']
            if not isinstance(pid, str) or not re.fullmatch(r'[a-z0-9_-]{1,80}', pid) or pid in seen:
                raise ValueError('Invalid or duplicate place ID')
            seen.add(pid)
            if not isinstance(record['name'], str) or not record['name'].strip() or len(record['name']) > 200:
                raise ValueError('Missing or excessive place name')
            if not isinstance(record.get('category'), str) or not record['category'].strip():
                raise ValueError('Missing place category')
            aliases = record.get('aliases', [])
            if not isinstance(aliases, list) or len(aliases) > 60 or any(not isinstance(a, str) or len(a) > 200 for a in aliases):
                raise ValueError('Invalid aliases')
            if pid in legacy:
                result[pid] = {**record, **legacy[pid], 'aliases': aliases,
                               'building_code': record.get('building_code', ''),
                               'building_number': record.get('building_number', '')}
                continue
            lat, lon = record['lat'], record['lon']
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lat, lon)):
                raise ValueError('Non-finite coordinates')
            if not bounds['south'] <= lat <= bounds['north'] or not bounds['west'] <= lon <= bounds['east']:
                raise ValueError('Outside the existing routing area')
            node = record.get('node')
            current = [graph.nodes[node]['x'], graph.nodes[node]['y']] if node in component else None
            if current is None or current != record.get('node_coordinates'):
                node, current = min(nodes, key=lambda item: metres([lon, lat], item[1]))
            snap = metres([lon, lat], current)
            if snap > 250:
                raise ValueError('More than 250 m from connected mapped walkways')
            if node not in covered_component:
                raise ValueError('No approach fully inside the mapped area')
            result[pid] = {**record, 'node': node, 'node_coordinates': current, 'snap_m': round(snap, 1)}
        except (KeyError, TypeError, ValueError) as exc:
            errors.append({'id': record.get('id') if isinstance(record, dict) else None, 'reason': str(exc)})
    return list(result.values()), errors


def load_places(graph, path=CATALOG):
    try:
        catalog = json.loads(Path(path).read_text(encoding='utf-8'))
        if not isinstance(catalog, dict) or not isinstance(catalog.get('places'), list):
            raise ValueError('Expected a campus places array')
        places, errors = attach_places(graph, catalog['places'])
        if errors:
            print(f'Campus places: excluded {len(errors)} invalid records')
        return places
    except (OSError, ValueError, UnicodeError) as exc:
        print(f'Campus catalog unavailable ({exc}); using saved graph places')
        return [dict(p) for p in graph.graph['places']]
