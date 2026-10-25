"""Documented room destinations anchored to a specific mapped building entrance.

Room guidance is schematic. Outdoor routing ends at the entrance; floor numbers
are not converted into fictitious outdoor coordinates or live indoor positions.
"""
import json
import re
from datetime import datetime
from pathlib import Path

from .geometry import metres
from .passages import available
from .places import normalize, public_place

CATALOG = Path(__file__).resolve().parents[1] / 'data/indoor_destinations.json'
ENTRANCES = CATALOG.with_name('building_entrances.json')


def is_room_query(value):
    return bool(re.fullmatch(r'(?:(?:zach|zachry)(?:room)?\d{3}[a-z]?|\d{3}[a-z]?(?:zach|zachry))', normalize(value).replace(' ', '')))


def load_destinations(graph, path=CATALOG, entrances_path=ENTRANCES):
    try:
        records = json.loads(Path(path).read_text(encoding='utf-8'))['destinations']
        if not isinstance(records, list):
            raise ValueError('Room destinations must be an array')
        buildings = json.loads(Path(entrances_path).read_text(encoding='utf-8'))['buildings']
    except (OSError, ValueError, KeyError, TypeError):
        return []
    result, seen = [], set()
    for r in records:
        try:
            pid = r['id']
            if not re.fullmatch(r'[a-z0-9_-]{1,80}', pid) or pid in seen:
                raise ValueError('Invalid or duplicate room ID')
            seen.add(pid)
            if not isinstance(r['name'], str) or not r['name'] or not isinstance(r['floor'], str):
                raise ValueError('Room name and floor required')
            if not isinstance(r['aliases'], list) or any(not isinstance(a, str) for a in r['aliases']):
                raise ValueError('Invalid room aliases')
            node = r['entrance_node']
            eligible = [d for b in buildings if b['place_id'] == r['building_id'] for d in b['entrances']
                        if d['osm_node'] == node and d.get('approach_eligible') is True
                        and (d.get('level_ref') == '1' or d.get('level') == '0')]
            if len(eligible) != 1:
                raise ValueError('Room needs a reviewed public ground-level entrance')
            if node not in graph or not graph.in_degree(node) or not graph.out_degree(node):
                raise ValueError('Room entrance is disconnected')
            coordinates = r['entrance_coordinates']
            if coordinates != eligible[0]['coordinates']:
                raise ValueError('Room entrance does not match the OSM inventory')
            if metres(coordinates, [graph.nodes[node]['x'], graph.nodes[node]['y']]) > 0.5:
                raise ValueError('Room entrance graph anchor changed; needs review')
            for field in ('arrival_steps', 'departure_steps'):
                if not isinstance(r[field], list) or not r[field] or any(not isinstance(s, str) or not s for s in r[field]):
                    raise ValueError('Missing room directions')
            if not isinstance(r.get('plan_page'), int) or isinstance(r['plan_page'], bool) or r['plan_page'] < 1:
                raise ValueError('Missing source plan page')
            if not isinstance(r.get('sources'), list) or not r['sources'] or any(
                    not isinstance(s, dict) or not isinstance(s.get('url'), str) or not s['url'].startswith('https://') for s in r['sources']):
                raise ValueError('Missing room plan sources')
            rule = {'enabled': True, 'access': 'public', **r}
            if not isinstance(r.get('weekly_hours'), dict) and r.get('weekly_hours') != '24/7':
                raise ValueError('Room needs a reviewed building schedule')
            available(rule, datetime.fromisoformat('2026-10-26T12:00:00-05:00'))  # validates the whole weekly schedule
            guidance = {key: r[key] for key in ('room', 'floor', 'plan_page', 'building_id', 'entrance_name', 'arrival_steps',
                                               'departure_steps', 'guidance_note', 'sources')}
            result.append({**{key: r[key] for key in ('id', 'name', 'category', 'aliases', 'building_code', 'room', 'floor', 'building_id')},
                           'lat': coordinates[1], 'lon': coordinates[0], 'node': node,
                           'node_coordinates': coordinates, 'snap_m': 0, 'indoor': guidance, '_indoor_rule': rule})
        except (KeyError, ValueError, TypeError, IndexError, OverflowError):
            continue
    return result


def room_available(endpoint, when):
    return '_indoor_rule' not in endpoint or available(endpoint['_indoor_rule'], when)


def room_guidance(start, end):
    return [{'endpoint': which, 'name': p['name'], **p['indoor']}
            for which, p in [('from', start), ('to', end)] if p.get('indoor')]


if __name__ == '__main__':
    import pickle
    graph = pickle.load(open('data/graph.pkl', 'rb'))
    places = [public_place(p) for p in load_destinations(graph)]
    Path('app/indoorPlaces.json').write_text(json.dumps(places, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(places)} documented room destinations')
