"""Inventory explicitly mapped OSM entrances; never infer doors from centroids.

python scripts/import_building_entrances.py --osm tmp/campus-entrances-osm.xml
"""
import argparse
import hashlib
import json
import pickle
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from campus_routing.geometry import metres
from campus_routing.places import normalize


def inventory(path, graph, places):
    root = ET.parse(path).getroot()
    tags = lambda e: {t.attrib['k']: t.attrib['v'] for t in e.findall('tag')}
    nodes = {int(n.attrib['id']): n for n in root.findall('node')}
    ways = {int(w.attrib['id']): w for w in root.findall('way')}
    buildings = []
    for element in [*ways.values(), *root.findall('relation')]:
        info = tags(element)
        if not info.get('building') or info['building'] in ('roof', 'yes') and not info.get('name'):
            continue
        if element.tag == 'way':
            rings = [element]
        else:
            rings = [ways[int(m.attrib['ref'])] for m in element.findall('member')
                     if m.attrib['type'] == 'way' and m.attrib.get('role') == 'outer' and int(m.attrib['ref']) in ways]
        refs = {int(n.attrib['ref']) for ring in rings for n in ring.findall('nd')}
        buildings.append((element.tag, element.attrib['id'], info, refs))
    output = []
    for place in places:
        number = str(place.get('building_number', '')).lstrip('0')
        names = {normalize(s) for s in [place['name'], *place.get('aliases', [])]}
        matches = [b for b in buildings if number and b[2].get('ref', '').lstrip('0') == number
                   or normalize(b[2].get('name', '')) in names]
        # A differently named or ambiguous footprint is reported as unmapped,
        # rather than assigning a nearby door to the wrong building.
        if len(matches) != 1:
            continue
        kind, bid, info, refs = matches[0]
        doors = []
        for nid in sorted(refs):
            n = nodes.get(nid)
            if n is None or 'entrance' not in tags(n):
                continue
            nt = tags(n)
            point = [float(n.attrib['lon']), float(n.attrib['lat'])]
            reason = None
            if nt['entrance'] in ('emergency', 'exit', 'no') or nt.get('emergency') == 'yes':
                reason = 'emergency, exit-only or closed entrance'
            elif nt.get('locked') == 'yes' or nt.get('foot', nt.get('access')) in ('no', 'private'):
                reason = 'restricted or locked'
            elif any('conditional' in k for k in nt):
                reason = 'conditional access needs review'
            elif nid not in graph or not graph.in_degree(nid) or not graph.out_degree(nid):
                reason = 'no saved outdoor walking connection'
            elif metres(point, [graph.nodes[nid]['x'], graph.nodes[nid]['y']]) > 0.5:
                reason = 'saved graph coordinates changed'
            doors.append({'osm_node': nid, 'coordinates': point, 'tags': nt,
                          'graph_connected': nid in graph, 'approach_eligible': reason is None,
                          'exclusion': reason, 'level': nt.get('level'), 'level_ref': nt.get('level:ref'),
                          'source': f'https://www.openstreetmap.org/node/{nid}'})
        output.append({'place_id': place['id'], 'building': place['name'],
                       'osm_type': kind, 'osm_id': int(bid),
                       'source': f'https://www.openstreetmap.org/{kind}/{bid}', 'entrances': doors})
    return {'schema_version': 1, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
            'source': 'OpenStreetMap contributors', 'license': 'ODbL-1.0',
            'snapshot_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            'limitations': 'Mapped doors are not proof of current access or interior corridors. Levels are retained; emergency exits are excluded. Missing entrance tags are not filled with guessed doors.',
            'buildings': output}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--osm', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('data/building_entrances.json'))
    args = parser.parse_args()
    graph = pickle.load(open('data/graph.pkl', 'rb'))
    places = json.loads(Path('data/campus_places.json').read_text(encoding='utf-8'))['places']
    result = inventory(args.osm, graph, places)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f"Matched {len(result['buildings'])} buildings; inventoried {sum(len(b['entrances']) for b in result['buildings'])} tagged entrances")
