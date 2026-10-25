"""Import official Aggie Map destinations inside the existing shaded walk graph.

No graph edges, shade masks, lighting evidence or routing bounds are changed.
Raw source snapshots stay in tmp; the normalized names/codes/points are bundled.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import pickle
import re
import sys
import urllib.parse
import urllib.request

from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from campus_routing.places import attach_places, public_place

SOURCE = 'https://gis.tamu.edu/arcgis/rest/services/FCOR/TAMU_Basemap_20261008/MapServer/2'
FIELDS = 'OBJECTID,Bldg_Number,BldgAbbrev,BldgName,Type,Private,status'
LEGACY = dict(commons='0440', zachry='0518', msc='0454', evans='0468.1', academic='0462',
              rudder='0446', ssb='1546', kyle='0367', rec='1560', reed='1554', sbisa='0495',
              wehner='1510', bell_tower='0350', corps='0384', cushing='0468.2', blocker='0524',
              langford='0398', agls='1535', bush_library='1606')
FRIENDLY = {'1500': 'ilsq', '1543': 'ilcb', '0520': 'beutel', '0450': 'duncan',
            '1416': 'hullabaloo', '1522': 'west_campus_dining',
            '1590': 'white_creek_a', '1591': 'white_creek_b', '1592': 'white_creek_c'}
ALIASES = {
    'commons': ['Commons Dining Hall', 'Commons Dining Center'],
    'zachry': ['Zach', 'Zachary', 'Zack', 'Zachry'],
    'wehner': ['Wehner', 'Mays', 'Mays Business School'],
    'evans': ['Sterling C Evans Library', 'Evans'], 'cushing': ['Cushing'],
    'ssb': ['Student Services'], 'langford': ['Langford A', 'Langford Architecture Center A'],
    'rec': ['Rec', 'Rec Center', 'Student Rec'],
    'beutel': ['Beutel', 'Buetul', 'Buetel', 'Beutal', 'A P Beutel', 'AP Beutel Health Center', 'Student Health Center'],
    'hullabaloo': ['Hullabaloo', 'Hullabaloo Hall'],
    'west_campus_dining': ['West Campus Food Hall', 'WCFH'],
    'century_tree': ['The Century Tree'], 'drill_field': ['Drill Field'],
    'bush_library': ['George Bush Library', 'Bush Presidential Library'],
}


def query(params):
    url = SOURCE + '/query?' + urllib.parse.urlencode({'f': 'json', **params})
    request = urllib.request.Request(url, headers={'User-Agent': 'SunScreen campus place catalog', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=35) as response:
        data = json.load(response)
    if data.get('error') or data.get('exceededTransferLimit'):
        raise ValueError('ArcGIS response was incomplete or returned an error')
    return data


def download(bounds, target):
    box = ','.join(str(bounds[k]) for k in ('west', 'south', 'east', 'north'))
    ids = query({'where': '1=1', 'returnIdsOnly': 'true', 'geometry': box, 'inSR': 4326,
                 'geometryType': 'esriGeometryEnvelope', 'spatialRel': 'esriSpatialRelIntersects'})['objectIds']
    features = []
    for start in range(0, len(ids), 200):
        batch = ids[start:start + 200]
        data = query({'objectIds': ','.join(map(str, batch)), 'outFields': FIELDS,
                      'returnGeometry': 'true', 'outSR': 4326})
        if len(data['features']) != len(batch):
            raise ValueError('Incomplete building batch')
        features.extend(data['features'])
    if len({f['attributes']['OBJECTID'] for f in features}) != len(ids):
        raise ValueError('Duplicate/missing building records')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({'features': features}), encoding='utf-8')


def category(kind, name):
    if 'cold storage' in name.lower():
        return 'Campus facilities'
    if 'health center' in name.lower():
        return 'Health & services'
    if kind == 'HOUSING TAMU':
        return 'Student life' if re.search('activity|community|laundry|office', name, re.I) else 'Residence halls'
    return {'ACADEMIC': 'Academic', 'RESEARCH': 'Academic', 'LIBRARY': 'Libraries',
            'DINING': 'Dining', 'SPORTS': 'Athletics', 'THE ASSOCIATION': 'Student life',
            'TAMU FOUNDATION': 'Student life'}.get(kind, 'Campus facilities')


def build(raw, graph):
    by_number = {number: pid for pid, number in LEGACY.items()}
    records = {p['id']: dict(p, aliases=ALIASES.get(p['id'], [])) for p in graph.graph['places']}
    excluded, reasons, seen_numbers = [], Counter(), set()
    for feature in sorted(raw['features'], key=lambda f: f['attributes']['OBJECTID']):
        a = {k: v.strip() if isinstance(v, str) else v for k, v in feature['attributes'].items()}
        name, number = a.get('BldgName'), a.get('Bldg_Number')
        reason = None
        if not name or not number:
            reasons['Unnamed/unidentified structure'] += 1
            continue
        if a.get('Private') != 'No' or a.get('status') != '1' or a.get('Type') == 'CONSTRUCTION':
            reason = 'Not a current public mapped building'
        elif number in seen_numbers:
            reason = 'Duplicate building number'
        if reason:
            reasons[reason] += 1
            excluded.append({'name': name, 'number': number, 'reason': reason})
            continue
        seen_numbers.add(number)
        rings = feature.get('geometry', {}).get('rings', [])
        try:
            polygons = [Polygon(ring) for ring in rings if len(ring) >= 4]
            polygon = max(polygons, key=lambda p: p.area)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            point = polygon.representative_point()
            if point.is_empty or polygon.area <= 0:
                raise ValueError('Empty footprint')
        except (ValueError, TypeError):
            reasons['Invalid building footprint'] += 1
            excluded.append({'name': name, 'number': number, 'reason': 'Invalid building footprint'})
            continue
        pid = by_number.get(number, FRIENDLY.get(number, 'building_' + re.sub(r'[^a-z0-9]+', '_', number.lower())))
        code = a.get('BldgAbbrev') or ''
        if code.isdigit():
            code = ''
        aliases = [name, code, number, 'building ' + number, 'bldg ' + number, *ALIASES.get(pid, [])]
        if 'Residence Hall' in name:
            aliases += [name.replace('Residence Hall', 'Hall'), name.replace('Residence Hall', 'Dorm'),
                        name.replace(' Residence Hall', '')]
        if '-Dorm ' in name:
            aliases += [name.replace('-Dorm ', ' Dorm '), name.split('-Dorm ')[0]]
        if 'White Creek Apartments ' in name:
            aliases.append(name.replace('Apartments ', ''))
        records[pid] = {**records.get(pid, {}), 'id': pid, 'name': records.get(pid, {}).get('name', name),
                        'category': records.get(pid, {}).get('category', category(a.get('Type'), name)),
                        'lat': records.get(pid, {}).get('lat', round(point.y, 7)),
                        'lon': records.get(pid, {}).get('lon', round(point.x, 7)),
                        'building_code': code, 'building_number': number,
                        'aliases': list(dict.fromkeys(x for x in aliases if x)),
                        'source_object_id': a['OBJECTID']}
    places, diagnostics = attach_places(graph, list(records.values()))
    for item in diagnostics:
        reasons[item['reason']] += 1
        excluded.append(item)
    places.sort(key=lambda p: p['id'])
    return places, {'source_footprints': len(raw['features']), 'destinations': len(places),
                    'categories': dict(Counter(p['category'] for p in places)),
                    'excluded_counts': dict(reasons), 'excluded_named': excluded}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--download', action='store_true')
    inputs.add_argument('--snapshot', type=Path)
    args = parser.parse_args()
    with (ROOT / 'data/graph.pkl').open('rb') as stream:
        graph = pickle.load(stream)
    snapshot = args.snapshot or ROOT / 'tmp/tamu-campus-buildings.json'
    if args.download:
        download(graph.graph['bounds'], snapshot)
    raw_bytes = snapshot.read_bytes()
    places, report = build(json.loads(raw_bytes.decode('utf-8-sig')), graph)
    catalog = {'schema_version': 1, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
               'source': {'name': 'Texas A&M Aggie Map, University Building layer', 'url': SOURCE,
                          'snapshot_sha256': hashlib.sha256(raw_bytes).hexdigest(),
                          'attribution': 'Texas A&M University Facilities Analytics & Mapping',
                          'license_note': 'Public map data; no open license declared by the service. Not an OSM import.'},
               'bounds': graph.graph['bounds'], 'places': places, 'coverage': report}
    (ROOT / 'data/campus_places.json').write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
    public = {'bounds': graph.graph['bounds'], 'default': graph.graph['default'],
              'places': [public_place(p) for p in places]}
    (ROOT / 'app/places.json').write_text(json.dumps(public, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'excluded_named'}, indent=2))
