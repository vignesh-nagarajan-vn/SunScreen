import copy
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import networkx as nx
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api import index
from campus_routing.candidates import join_routes, passage_candidates
from campus_routing.indoors import is_room_query, load_destinations
from campus_routing.passages import add_passages
from test_building_passages import fixture

ROOT = Path(__file__).resolve().parents[1]
DAY = datetime.fromisoformat('2026-10-26T14:00:00-05:00')
MSC = 'msc-leadership-integrity-first-floor'


def route_at(when=DAY, source='commons', target='zachry_596', mode='shade', **kwargs):
    with patch.object(index, 'weather_at', return_value={'sun_strength_pct': 100}), \
         patch.object(index, 'departure_for_slot', return_value=when), \
         patch.object(index, 'datetime', wraps=datetime) as clock:
        clock.now.return_value = when
        return index.route('14:00', source, target, mode=mode, **kwargs)


class IndoorRoutingTests(unittest.TestCase):
    def test_inventory_preserves_emergency_exits_and_raised_levels_without_enabling_them_for_room_entry(self):
        audit = json.loads((ROOT / 'data/building_entrances.json').read_text())
        by_id = {b['place_id']: b for b in audit['buildings']}
        self.assertGreaterEqual(len(by_id), 200)
        self.assertEqual(by_id['msc']['entrances'], [])  # OSM does not explicitly tag MSC doors.
        zach = by_id['zachry']['entrances']
        self.assertEqual(len(zach), 8)
        self.assertEqual(sum(d['approach_eligible'] for d in zach), 4)
        self.assertTrue(all(not d['approach_eligible'] for d in zach if d['tags']['entrance'] == 'emergency'))
        self.assertEqual([d['osm_node'] for d in zach if d['approach_eligible'] and d['level_ref'] == '1'], [6193744746])

    def test_room_aliases_and_unsupported_rooms_never_use_an_external_geocoder(self):
        with patch.object(index.urllib.request, 'urlopen', side_effect=AssertionError('External geocoder')):
            for value in ('Zach 596', 'ZACH596', 'Zachry room 596', '596 ZACH'):
                self.assertEqual(index.search(value)['results'][0]['id'], 'zachry_596')
                self.assertEqual(index.endpoint(value, 'Destination')['node'], 6193744746)
            self.assertEqual(index.search('ZACH 999')['results'], [])
            self.assertIn('not mapped', index.search('ZACH 999')['message'].replace("aren't mapped", 'not mapped'))
            with self.assertRaises(HTTPException):
                index.endpoint('ZACH 999', 'Destination')
        self.assertFalse(is_room_query('Zachry Engineering'))
        self.assertFalse(is_room_query('596 Main Street'))

    def test_room_routes_use_one_level_1_entrance_in_both_modes_and_directions(self):
        for mode in ('shade', 'lighting'):
            for source, target, which in [('commons', 'Zach 596', 'to'), ('Zach 596', 'commons', 'from')]:
                with self.subTest(mode=mode, source=source):
                    data = route_at(source=source, target=target, mode=mode)
                    room = data['end' if which == 'to' else 'start']
                    self.assertEqual(room['id'], 'zachry_596')
                    self.assertEqual((room['lon'], room['lat']), (-96.3398443, 30.6209274))
                    self.assertEqual(len(data['features']), 3)
                    self.assertEqual(data['indoor_guidance'][0]['endpoint'], which)
                    self.assertEqual(data['indoor_guidance'][0]['floor'], '5')
                    self.assertEqual(data['walking_estimate_scope'], 'outdoor_to_entrance')
                    self.assertTrue(all(f['geometry']['coordinates'][-1 if which == 'to' else 0] == [room['lon'], room['lat']] for f in data['features']))

    def test_room_building_closure_is_checked_at_departure_and_arrival(self):
        cases = [(datetime.fromisoformat('2026-10-24T08:00:00-05:00'), 'zachry_596', 'commons', 'starting building'),
                 (datetime.fromisoformat('2026-10-24T23:58:00-05:00'), 'commons', 'zachry_596', 'arrival time')]
        for when, source, target, message in cases:
            for mode in ('shade', 'lighting'):
                with self.assertRaises(HTTPException) as exc:
                    route_at(when, source, target, mode)
                self.assertIn(message, exc.exception.detail)

    def test_same_building_requests_do_not_invent_an_outdoor_trip_between_floors(self):
        for a, b in [('zachry', 'zachry_596'), ('zachry_596', 'zachry')]:
            with self.assertRaises(HTTPException) as exc:
                route_at(source=a, target=b)
            self.assertIn('indoor directions', exc.exception.detail)

    def test_missing_malformed_stale_emergency_and_raised_room_anchors_are_isolated(self):
        original = json.loads((ROOT / 'data/indoor_destinations.json').read_text())
        inventory = json.loads((ROOT / 'data/building_entrances.json').read_text())
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'rooms.json'
            path.write_text('{broken')
            self.assertEqual(load_destinations(index.G, path), [])
            for node in (999999999999, 8502687833, 10689401975):
                bad = copy.deepcopy(original); r = bad['destinations'][0]; r['entrance_node'] = node
                if node in index.G:
                    r['entrance_coordinates'] = [index.G.nodes[node]['x'], index.G.nodes[node]['y']]
                path.write_text(json.dumps(bad))
                self.assertEqual(load_destinations(index.G, path), [])
            bad = copy.deepcopy(original); bad['destinations'][0]['entrance_coordinates'][0] += 0.001
            path.write_text(json.dumps(bad)); self.assertEqual(load_destinations(index.G, path), [])
            path.write_text(json.dumps(original))
            self.assertEqual(load_destinations(index.G, path, Path(tmp) / 'missing-inventory.json'), [])
            self.assertEqual(len(load_destinations(index.G, path)), 1)

    def test_api_room_metadata_is_public_and_entrance_inventory_is_available(self):
        client = TestClient(index.app)
        room = next(p for p in client.get('/api/places').json()['places'] if p['id'] == 'zachry_596')
        self.assertEqual(room['floor'], '5')
        self.assertNotIn('node', room)
        self.assertNotIn('_indoor_rule', room)
        self.assertTrue(room['indoor']['arrival_steps'])
        self.assertGreaterEqual(len(client.get('/api/building-entrances').json()['buildings']), 200)

    def test_msc_is_considered_without_forcing_it_past_the_recommended_limit(self):
        for a, b in [('ilsq', 'commons'), ('commons', 'ilsq')]:
            data = route_at(source=a, target=b)
            fastest, recommended, most_shade = [f['properties'] for f in data['features']]
            self.assertNotIn('Memorial Student Center', recommended['via_buildings'])
            self.assertIn('Memorial Student Center', most_shade['via_buildings'])
            self.assertLessEqual(most_shade['distance_m'], fastest['distance_m'] * 1.3 + 2)
            self.assertGreater(most_shade['shaded_pct'], recommended['shaded_pct'])
            self.assertTrue(most_shade['access_unconfirmed'])
        strict = route_at(source='ilsq', target='commons', recommended_pct=0, max_detour_pct=0)
        self.assertTrue(all(f['properties']['distance_m'] == strict['features'][0]['properties']['distance_m'] for f in strict['features']))

    def test_msc_closed_or_restricted_at_departure_and_closure_during_traversal_keep_outdoor_routes(self):
        sunday = datetime.fromisoformat('2026-10-25T09:00:00-05:00')
        data = route_at(sunday, 'ilsq', 'commons')
        self.assertNotIn(MSC, data['building_routing']['available_passages'])
        for restrictions in ({'closed': True}, {'access': 'private'}, {'weekly_hours': {'mon': [['13:00', '14:01']]}}):
            catalog = copy.deepcopy(index.PASSAGES)
            next(r for r in catalog['passages'] if r['id'] == MSC).update(restrictions)
            with patch.object(index, 'PASSAGES', catalog):
                result = route_at(source='ilsq', target='commons')
            self.assertTrue(all('Memorial Student Center' not in f['properties']['via_buildings'] for f in result['features']))

    def test_unmapped_msc_approach_does_not_receive_fictitious_roof_shade(self):
        graph, _ = add_passages(index.G, index.PASSAGES, DAY)
        record = next(r for r in index.PASSAGES['passages'] if r['id'] == MSC)
        a = record['doors'][0]['node']; b = f'passage:{MSC}:0'
        attrs = next(d for d in graph[a][b].values() if d.get('passage_id') == MSC)
        self.assertEqual(attrs['environment'], 'outdoor')
        self.assertTrue(all(v == 0 for v in attrs['shade']))

    def test_msc_indoor_sections_stay_in_the_footprint_and_out_of_the_courtyard(self):
        from shapely.geometry import Polygon, LineString
        record = next(r for r in index.PASSAGES['passages'] if r['id'] == MSC)
        boundary = record['footprint_review']
        polygon = Polygon(boundary['outer'], boundary['holes']).buffer(0.000008)
        for section in record['sections']:
            if section['environment'] == 'indoor':
                self.assertTrue(polygon.covers(LineString(section['coordinates'])), section['description'])

    def test_explicit_candidate_respects_oneway_and_keeps_source_graph_immutable(self):
        base, catalog = fixture(); record = catalog['passages'][0]; record['oneway'] = True
        graph, _ = add_passages(base, catalog, DAY)
        forward = list(passage_candidates(graph, [record], 1, 4, 0, [0, 1, 4], 500, index.shortest, index.summarize_path))
        reverse = list(passage_candidates(graph, [record], 4, 1, 0, [0, 1, 4], 500, index.shortest, index.summarize_path))
        self.assertTrue(forward)
        self.assertEqual(reverse, [])
        self.assertEqual(len(base), 4)
        self.assertTrue(all(len(c['path']) == len(set(c['path'])) for c in forward))

    def test_joined_candidates_reject_loops_and_disconnected_parts(self):
        self.assertIsNone(join_routes([{'path': (1, 2)}, {'path': (2, 3)}, {'path': (3, 1, 4)}]))
        self.assertIsNone(join_routes([{'path': (1, 2)}, {'path': (3, 4)}]))

