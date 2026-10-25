"""Validated, isolated building overlays on the existing campus walk graph."""
import json
import math
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .geometry import fingerprint, merge_ranges, metres, slice_line

TZ = ZoneInfo('America/Chicago')
DAYS = ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')


def load_catalog(path=None):
    path = path or Path(__file__).resolve().parents[1] / 'data' / 'building_passages.json'
    try:
        catalog = json.loads(Path(path).read_text(encoding='utf-8'))
        if not isinstance(catalog, dict):
            raise ValueError('Catalog must be an object')
        for key in ('passages', 'covered_walkways'):
            if not isinstance(catalog.get(key, []), list):
                raise ValueError(f'{key} must be an array')
        return catalog
    except (OSError, ValueError, UnicodeError) as exc:
        return {'passages': [], 'covered_walkways': [], 'errors': [f'Catalog unavailable: {exc}']}


def _clock(value, end=False):
    if not isinstance(value, str) or len(value) != 5 or value[2] != ':':
        raise ValueError('Hours must use HH:MM')
    h, m = int(value[:2]), int(value[3:])
    if not 0 <= m < 60 or not 0 <= h < 24:
        if end and value == '24:00':
            return 1440
        raise ValueError('Invalid opening hours')
    return 60 * h + m


def access_status(record):
    return 'scheduled' if record.get('weekly_hours') is not None else 'unconfirmed'


def available(record, start, end=None):
    """Check an entire traversal interval, including overnight hours and closures.

    Unknown hours require an explicit catalog policy; they are never called open.
    The policy is kept in data, not exposed as a phone navigation control.
    """
    if not isinstance(record, dict) or record.get('enabled') is not True or record.get('closed'):
        return False
    if record.get('access', 'public') != 'public':
        return False
    end = start if end is None else end
    if start.tzinfo is None or end.tzinfo is None or end.timestamp() < start.timestamp():
        raise ValueError('Traversal must have ordered timezone-aware timestamps')
    start, end = start.astimezone(TZ), end.astimezone(TZ)
    if end.timestamp() - start.timestamp() > 86400:
        return False
    last_day = (end - timedelta(microseconds=1)).date() if end > start else end.date()
    closed = set(record.get('closed_dates', []))
    day = start.date()
    while day <= last_day:
        if day.isoformat() in closed:
            return False
        day += timedelta(days=1)
    if record.get('valid_until') and last_day > datetime.fromisoformat(record['valid_until']).date():
        return False
    hours = record.get('weekly_hours')
    if hours == '24/7':
        return True
    if hours is None:
        return record.get('unknown_hours_policy') == 'allow_with_notice'
    if not isinstance(hours, dict):
        raise ValueError('weekly_hours must be 24/7 or a weekday object')
    # Validate the entire schedule, even if today's entry happens to be empty.
    for name, windows in hours.items():
        if name not in DAYS or not isinstance(windows, list):
            raise ValueError('Invalid weekly schedule')
        for window in windows:
            if not isinstance(window, list) or len(window) != 2:
                raise ValueError('Opening windows require two times')
            a, b = _clock(window[0]), _clock(window[1], end=True)
            if a == b:
                raise ValueError('Use 24/7 instead of an ambiguous all-day window')
    intervals = []
    for offset in (-1, 0, 1):
        day = start.date() + timedelta(days=offset)
        for a, b in hours.get(DAYS[day.weekday()], []):
            lo, hi = _clock(a), _clock(b, end=True)
            if hi < lo:
                hi += 1440
            midnight = datetime.combine(day, time(), TZ)
            intervals.append([(midnight + timedelta(minutes=lo)).timestamp(),
                              (midnight + timedelta(minutes=hi)).timestamp()])
    for low, high in merge_ranges(intervals):
        if low <= start.timestamp() < high and end.timestamp() <= high:
            return True
    return False


def _point(c):
    if not isinstance(c, list) or len(c) != 2 or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in c):
        raise ValueError('Coordinates must be finite longitude/latitude pairs')
    if not -180 <= c[0] <= 180 or not -90 <= c[1] <= 90:
        raise ValueError('Coordinate outside longitude/latitude bounds')


def _coords(coords):
    if not isinstance(coords, list) or not 2 <= len(coords) <= 10000:
        raise ValueError('A section needs 2-10000 coordinates')
    for c in coords:
        _point(c)
    if any(metres(a, b) < 1e-6 for a, b in zip(coords, coords[1:])):
        raise ValueError('Repeated consecutive coordinates')


def _identity(record, seen):
    if not isinstance(record, dict):
        raise ValueError('Record must be an object')
    key = record.get('id')
    if not isinstance(key, str) or not key or len(key) > 120 or key in seen:
        raise ValueError('Missing or duplicate passage ID')
    seen.add(key)
    return key


def _passage_plan(base, record, graph):
    doors = record['doors']
    if not isinstance(doors, list) or len(doors) != 2 or doors[0]['node'] == doors[1]['node']:
        raise ValueError('Two distinct mapped doors are required')
    for door in doors:
        _point(door['coordinates'])
        node = door['node']
        if node not in base or not base.in_degree(node) or not base.out_degree(node):
            raise ValueError(f'Entrance {node} has no outdoor connection')
        if metres([base.nodes[node]['x'], base.nodes[node]['y']], door['coordinates']) > 0.5:
            raise ValueError('Door coordinates do not match the saved graph')
    sections = record['sections']
    if not isinstance(sections, list) or not 1 <= len(sections) <= 100:
        raise ValueError('Missing or excessive corridor sections')
    previous, expected = doors[0]['node'], doors[0]['coordinates']
    edges, nodes = [], []
    for i, section in enumerate(sections):
        coords = section['coordinates']
        _coords(coords)
        if metres(expected, coords[0]) > 0.05:
            raise ValueError('Sections must connect continuously')
        environment = section['environment']
        if environment not in ('indoor', 'covered', 'outdoor'):
            raise ValueError('Unknown passage environment')
        length = sum(metres(a, b) for a, b in zip(coords, coords[1:]))
        next_node = doors[1]['node'] if i == len(sections) - 1 else f"passage:{record['id']}:{i}"
        if i != len(sections) - 1:
            if next_node in graph:
                raise ValueError('Conflicting virtual node ID')
            nodes.append((next_node, dict(x=coords[-1][0], y=coords[-1][1], passage=True)))
        elif metres(coords[-1], doors[1]['coordinates']) > 0.05:
            raise ValueError('Corridor does not end at the mapped exit')
        attrs = dict(length=length, shade=tuple((0.0 if environment == 'outdoor' else 1.0) for _ in base.graph['slots']), coords=coords,
                     passage_id=record['id'], building=record['building'], environment=environment,
                     verification=record.get('verification', ''), access_status=access_status(record),
                     access_unconfirmed=record.get('access_verified') is not True)
        edges.append((previous, next_node, attrs))
        if not record.get('oneway', False):
            edges.append((next_node, previous, dict(attrs, coords=list(reversed(coords)))))
        previous, expected = next_node, coords[-1]
    return nodes, edges


def _covered_plan(base, record):
    result = []
    if not isinstance(record['edges'], list) or not record['edges']:
        raise ValueError('Covered path needs existing edges')
    for entry in record['edges']:
        if isinstance(entry, list):
            if len(entry) != 2:
                raise ValueError('Legacy edge needs two endpoints')
            directions = [(entry[0], entry[1]), (entry[1], entry[0])]
            for u, v in directions:
                if not base.has_edge(u, v) or len(base[u][v]) != 1:
                    raise ValueError('Missing or ambiguous parallel covered edge')
                key = next(iter(base[u][v]))
                result.append(((u, v, key), [[0.0, 1.0]], record))
            continue
        u, v, key = entry['u'], entry['v'], entry['key']
        if not base.has_edge(u, v, key):
            raise ValueError('Covered walkway edge is missing')
        if entry['geometry_sha256'] != fingerprint(base[u][v][key]['coords']):
            raise ValueError('Covered walkway geometry changed; reimport required')
        ranges = entry['ranges']
        if not isinstance(ranges, list) or not ranges:
            raise ValueError('Missing covered ranges')
        for a, b in ranges:
            if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in (a, b)) or not 0 <= a < b <= 1:
                raise ValueError('Covered fractions must satisfy 0 <= start < end <= 1')
        # Validate every resulting geometry before accepting any of this record.
        # Tiny intervals can collapse to one coordinate at floating precision.
        cuts = sorted(set([0.0, 1.0] + [x for r in merge_ranges(ranges) for x in r]))
        for a, b in zip(cuts, cuts[1:]):
            slice_line(base[u][v][key]['coords'], a, b)
        result.append(((u, v, key), merge_ranges(ranges), record))
    return result


def _split_cover(graph, base, edge_id, ranges, records):
    u, v, key = edge_id
    old = base[u][v][key]
    ranges = merge_ranges(ranges)
    fraction = sum(b - a for a, b in ranges)
    cuts = sorted(set([0.0, 1.0] + [x for r in ranges for x in r]))
    # Preserve the original aggregate shade where the roof was already counted.
    # Known roof cover only raises the total if the old mask undercounted it.
    uncovered = tuple(max(0.0, min(1.0, (s - fraction) / (1 - fraction)))
                      for s in old['shade']) if fraction < 1 else old['shade']
    graph.remove_edge(u, v, key)
    previous = u
    for i, (a, b) in enumerate(zip(cuts, cuts[1:])):
        coords = slice_line(old['coords'], a, b)
        next_node = v if b == 1 else f'roof:{u}:{v}:{key}:{i}'
        if next_node != v:
            if next_node in graph:
                raise ValueError('Conflicting roof split node')
            graph.add_node(next_node, x=coords[-1][0], y=coords[-1][1], passage=True)
        attrs = dict(old, coords=coords, length=old['length'] * (b - a))
        covered = any(low <= (a + b) / 2 <= high for low, high in ranges)
        attrs['shade'] = tuple(1.0 for _ in old['shade']) if covered else uncovered
        if covered:
            first = records[0]
            attrs.update(passage_id=first['id'], building=first['name'], environment='covered',
                         verification=first.get('verification', ''), access_status='outdoor')
        graph.add_edge(previous, next_node, key=key, **attrs)
        previous = next_node


def add_passages(base, catalog, departure=None):
    """Apply records independently; one invalid record cannot disable valid roofs.

    All validation finishes before a corridor or a canopy record is committed.
    Diagnostics stay in graph metadata; the phone still has only three choices.
    """
    departure = departure or datetime.now(TZ)
    graph = base.copy()
    reports, diagnostics, seen, covered = [], list(catalog.get('errors', [])), set(), {}
    graph.graph['passage_rules'] = {}
    for kind in ('covered_walkways', 'passages'):
        for record in catalog.get(kind, []):
            try:
                identity = _identity(record, seen)
                if kind == 'covered_walkways' and record.get('weekly_hours') is None:
                    record = dict(record, weekly_hours='24/7')
                if not available(record, departure):
                    diagnostics.append({'id': identity, 'reason': 'closed, restricted, expired or unavailable at departure'})
                    continue
                if kind == 'covered_walkways':
                    plans = _covered_plan(base, record)
                    for edge_id, ranges, item in plans:
                        group = covered.setdefault(edge_id, {'ranges': [], 'records': []})
                        group['ranges'].extend(ranges)
                        group['records'].append(item)
                else:
                    nodes, edges = _passage_plan(base, record, graph)
                    graph.add_nodes_from(nodes)
                    for u, v, attrs in edges:
                        graph.add_edge(u, v, **attrs)
                graph.graph['passage_rules'][identity] = record
                reports.append({'id': identity, 'building': record.get('building', record.get('name')),
                                'access_status': access_status(record) if kind == 'passages' else 'outdoor'})
            except (ValueError, KeyError, TypeError, IndexError, OverflowError) as exc:
                diagnostics.append({'id': record.get('id') if isinstance(record, dict) else None, 'reason': str(exc)})
    for edge_id, group in covered.items():
        _split_cover(graph, base, edge_id, group['ranges'], group['records'])
    graph.graph['passage_diagnostics'] = diagnostics
    return graph, reports


def traversal_available(route, graph, departure, walk_mps=1.4):
    """Reject candidates that reach or leave a building after its hours change."""
    for run in route['building_runs']:
        record = graph.graph.get('passage_rules', {}).get(run['passage_id'])
        if record is None:
            return False
        start = datetime.fromtimestamp(departure.timestamp() + run['start_m'] / walk_mps, TZ)
        end = datetime.fromtimestamp(departure.timestamp() + run['end_m'] / walk_mps, TZ)
        if not available(record, start, end):
            return False
    return True
