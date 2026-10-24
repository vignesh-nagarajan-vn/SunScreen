"""Audit a public OSM snapshot and match roofed paths to the saved walk graph.

python scripts/import_building_paths.py --osm tmp/campus-osm.xml
No new indoor corridors are inferred from footprints. Roads and driveways are
excluded. The generated catalog only annotates existing pedestrian geometry.
"""
import argparse
import hashlib
import json
import pickle
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from campus_routing.geometry import fingerprint, line_overlap, polygon_overlap


def bbox(coords):
    return min(p[0] for p in coords), min(p[1] for p in coords), max(p[0] for p in coords), max(p[1] for p in coords)


def overlaps(a, b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def audit(osm_path, graph):
    root = ET.parse(osm_path).getroot()
    nodes = {int(n.attrib['id']): [float(n.attrib['lon']), float(n.attrib['lat'])] for n in root.findall('node')}
    blocked_nodes = set()
    for node in root.findall('node'):
        tags = {t.attrib['k']: t.attrib['v'] for t in node.findall('tag')}
        if tags.get('entrance') in ('emergency', 'exit') or tags.get('locked') == 'yes' or tags.get('foot', tags.get('access')) in ('no', 'private'):
            blocked_nodes.add(int(node.attrib['id']))
    sources, buildings, exclusions = [], [], []
    for way in root.findall('way'):
        tags = {t.attrib['k']: t.attrib['v'] for t in way.findall('tag')}
        refs = [int(n.attrib['ref']) for n in way.findall('nd')]
        if any(n not in nodes for n in refs) or len(refs) < 2:
            continue
        coords = [nodes[n] for n in refs]
        way_id = way.attrib['id']
        if tags.get('building'):
            buildings.append({'osm_way': way_id, 'name': tags.get('name'), 'tags': tags, 'coords': coords})
        roof_path = tags.get('covered') == 'yes' or tags.get('tunnel') == 'building_passage'
        if tags.get('highway') and roof_path:
            reason = None
            if tags['highway'] not in ('footway', 'pedestrian', 'path'):
                reason = 'Not an explicitly pedestrian path (roads/driveways excluded)'
            elif tags.get('foot', tags.get('access', 'yes')) not in ('yes', 'designated', 'permissive'):
                reason = 'Restricted pedestrian access'
            elif any('conditional' in key or key == 'opening_hours' for key in tags):
                reason = 'Conditional access needs manual review'
            elif any(n in blocked_nodes for n in refs):
                reason = 'Locked, restricted or exit-only node on the mapped path'
            if reason:
                exclusions.append({'osm_way': way_id, 'reason': reason})
            else:
                sources.append({'id': way_id, 'name': tags.get('name', 'Covered campus walkway'),
                                'coords': coords, 'polygon': False, 'tags': tags})
        # A raised structure or a roof can cover an EXISTING outdoor footpath.
        try:
            raised = float(tags.get('building:min_level', 0)) >= 1
        except ValueError:
            raised = False
        if (raised or tags.get('building') == 'roof') and refs[0] == refs[-1]:
            sources.append({'id': way_id, 'name': tags.get('name', 'Raised building canopy'),
                            'coords': coords, 'polygon': True, 'tags': tags})
    records = []
    for source in sources:
        bounds = bbox(source['coords'])
        # Permit coordinate rounding from the simplified graph, about 10 cm.
        bounds = bounds[0] - 0.000005, bounds[1] - 0.000005, bounds[2] + 0.000005, bounds[3] + 0.000005
        edges = []
        for u, v, key, edge in graph.edges(keys=True, data=True):
            if not overlaps(bounds, bbox(edge['coords'])):
                continue
            ranges = (polygon_overlap(edge['coords'], source['coords']) if source['polygon'] else
                      line_overlap(edge['coords'], source['coords']))
            if ranges:
                edges.append({'u': u, 'v': v, 'key': key, 'ranges': ranges,
                              'geometry_sha256': fingerprint(edge['coords'])})
        if edges:
            records.append({'id': f"osm-roof-{source['id']}", 'name': source['name'],
                            'enabled': True, 'access': 'public', 'environment': 'covered',
                            'weekly_hours': '24/7',
                            'verification': 'Public OSM roof/raised structure over existing pedestrian geometry; not an enclosed corridor.',
                            'sources': [{'url': f"https://www.openstreetmap.org/way/{source['id']}",
                                         'tags': source['tags'], 'license': 'ODbL-1.0, OpenStreetMap contributors'}],
                            'edges': edges})
        else:
            exclusions.append({'osm_way': source['id'], 'reason': 'No matching saved pedestrian edge geometry'})
    report = {'checked': datetime.now(ZoneInfo('America/Chicago')).date().isoformat(), 'osm_sha256': hashlib.sha256(Path(osm_path).read_bytes()).hexdigest(),
              'building_footprints_audited': len(buildings),
              'named_buildings_audited': sum(bool(b['name']) for b in buildings),
              'explicit_indoor_pedestrian_ways': sum(1 for w in root.findall('way')
                  if {t.attrib['k']: t.attrib['v'] for t in w.findall('tag')}.get('indoor') in ('yes', 'corridor')),
              'matched_roof_records': len(records), 'excluded': exclusions,
              'limits': 'Footprints are not floor plans. Missing corridors, entrances, floor transitions and schedules are not invented.'}
    return records, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--osm', type=Path)
    inputs.add_argument('--download', action='store_true', help='Download the app coverage from the public OSM API')
    parser.add_argument('--graph', default=Path('data/graph.pkl'), type=Path)
    parser.add_argument('--catalog', default=Path('data/building_passages.json'), type=Path)
    parser.add_argument('--report', default=Path('data/building_coverage.json'), type=Path)
    args = parser.parse_args()
    if args.download:
        area = json.loads(Path('data/area.json').read_text())
        bounds = ','.join(str(v) for v in area['bbox_wgs84'])
        args.osm = Path('tmp/campus-osm.xml')
        args.osm.parent.mkdir(exist_ok=True)
        request = urllib.request.Request('https://api.openstreetmap.org/api/0.6/map?bbox=' + bounds,
                                         headers={'User-Agent': 'SunScreen campus passage audit'})
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read()
        ET.fromstring(raw)  # Refuse incomplete downloads before replacing a snapshot.
        args.osm.write_bytes(raw)
    with args.graph.open('rb') as stream:
        graph = pickle.load(stream)
    records, report = audit(args.osm, graph)
    catalog = json.loads(args.catalog.read_text(encoding='utf-8'))
    manual = [r for r in catalog.get('covered_walkways', []) if not r['id'].startswith('osm-roof-')]
    catalog['covered_walkways'] = manual + records
    catalog['coverage_summary'] = {k: report[k] for k in ('checked', 'building_footprints_audited',
                                  'named_buildings_audited', 'matched_roof_records', 'explicit_indoor_pedestrian_ways')}
    args.catalog.write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f"Matched {len(records)} roof records; audited {report['building_footprints_audited']} building footprints")
