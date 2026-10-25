import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import networkx as nx

from api import index
from campus_routing.places import attach_places, load_places, match_score, public_place, resolve_place, search_places

ROOT = Path(__file__).resolve().parents[1]


class CampusPlaceTests(unittest.TestCase):
    def test_shared_search_cases_match_offline_client(self):
        cases = json.loads((ROOT / 'tests/fixtures/place-search.json').read_text(encoding='utf-8'))
        for case in cases:
            with self.subTest(query=case['query']):
                results = search_places(index.PLACES.values(), case['query'])
                self.assertEqual(results[0]['id'] if results else None, case['first'])
                exact = resolve_place(index.PLACES.values(), case['query'])
                self.assertEqual(exact['id'] if exact else None, case['exact'])

    def test_alias_search_never_needs_an_external_geocoder(self):
        with patch.object(index.urllib.request, 'urlopen', side_effect=AssertionError('External request')):
            for query, pid in [('ILSQ', 'ilsq'), ('ILCB', 'ilcb'), ('Buetul', 'beutel'), ('HLBL', 'hullabaloo')]:
                self.assertEqual(index.search(query)['results'][0]['id'], pid)
                self.assertEqual(index.endpoint(query, 'Destination')['id'], pid)

    def test_catalog_is_bounded_unique_and_connected_in_both_directions(self):
        records = list(index.PLACES.values())
        self.assertGreaterEqual(len(records), 350)
        self.assertEqual(len(records), len({p['id'] for p in records}))
        anchor = index.PLACES[index.DEFAULT[0]]['node']
        component = next(c for c in nx.strongly_connected_components(index.G) if anchor in c)
        for p in records:
            with self.subTest(place=p['id']):
                self.assertTrue(index.B['south'] <= p['lat'] <= index.B['north'])
                self.assertTrue(index.B['west'] <= p['lon'] <= index.B['east'])
                self.assertIn(p['node'], component)
                if p['id'] not in {old['id'] for old in index.G.graph['places']}:
                    self.assertLessEqual(p['snap_m'], 250)

    def test_legacy_places_keep_original_ids_coordinates_and_anchors(self):
        for old in index.G.graph['places']:
            for key in ('id', 'name', 'node', 'lat', 'lon'):
                self.assertEqual(index.PLACES[old['id']][key], old[key])

    def test_api_serves_aliases_and_routes_distinct_requested_buildings(self):
        client = TestClient(index.app)
        catalog = client.get('/api/places').json()['places']
        self.assertGreaterEqual(len(catalog), 350)
        self.assertIn('Buetul', next(p for p in catalog if p['id'] == 'beutel')['aliases'])
        with patch.object(index, 'weather_at', return_value={'sun_strength_pct': 100}):
            for mode in ('shade', 'lighting'):
                result = client.get('/api/route', params={'from': 'ILSQ', 'to': 'ILCB', 'mode': mode})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()['start']['id'], 'ilsq')
                self.assertEqual(result.json()['end']['id'], 'ilcb')
                self.assertEqual(len(result.json()['features']), 3)
                self.assertTrue(all(f['properties']['distance_m'] > 0 for f in result.json()['features']))

    def test_unrecognized_addresses_keep_the_bounded_address_search(self):
        class Response:
            def __enter__(self):
                import io
                return io.StringIO(json.dumps([{'name': 'Test address', 'lat': '30.615', 'lon': '-96.34'}]))
            def __exit__(self, *args):
                pass
        with patch.object(index.urllib.request, 'urlopen', return_value=Response()) as request:
            self.assertEqual(index.search('unmatched testing address qzx')['results'][0]['name'], 'Test address')
        self.assertIn('bounded=1', request.call_args.args[0].full_url)

    def test_invalid_records_are_isolated_and_stale_anchors_are_resnapped(self):
        record = copy.deepcopy(index.PLACES['ilsq'])
        record['node'] = -999
        bad = dict(record, id='invalid-point', lat=float('nan'))
        records, errors = attach_places(index.G, [record, bad])
        self.assertEqual(next(p for p in records if p['id'] == 'ilsq')['node'], index.PLACES['ilsq']['node'])
        self.assertEqual(len(errors), 1)
        self.assertNotIn('invalid-point', {p['id'] for p in records})

    def test_broken_catalog_falls_back_to_saved_graph_places(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'catalog.json'
            for raw in ('bad json', '{}', '[]', '{"places":null}'):
                path.write_text(raw)
                self.assertEqual(load_places(index.G, path), index.G.graph['places'])

    def test_ambiguous_codes_are_suggestions_not_silent_endpoint_choices(self):
        places = [dict(id='a', name='First', aliases=['DUPE']), dict(id='b', name='Second', aliases=['DUPE'])]
        self.assertEqual(len(search_places(places, 'DUPE')), 2)
        self.assertIsNone(resolve_place(places, 'DUPE'))

    def test_baked_picker_catalog_matches_api_and_omits_internal_node_ids(self):
        bundled = json.loads((ROOT / 'app/places.json').read_text(encoding='utf-8'))
        bundled['places'] += json.loads((ROOT / 'app/indoorPlaces.json').read_text(encoding='utf-8'))
        actual = index.places()
        self.assertEqual({p['id']: p for p in bundled['places']}, {p['id']: p for p in actual['places']})
        self.assertTrue(all('node' not in p for p in actual['places']))

    def test_nearby_buildings_sharing_an_anchor_get_an_honest_map_pin_hint(self):
        by_node = {}
        pair = None
        for p in index.PLACES.values():
            if p['node'] in by_node:
                pair = by_node[p['node']]['id'], p['id']
                break
            by_node[p['node']] = p
        self.assertIsNotNone(pair)
        response = TestClient(index.app).get('/api/route', params={'from': pair[0], 'to': pair[1]})
        self.assertEqual(response.status_code, 400)
        self.assertIn('share the same mapped walkway point', response.json()['detail'])

    def test_destination_requiring_a_path_outside_the_map_is_not_preloaded(self):
        graph = nx.MultiDiGraph()
        for n, x in ((1, 0), (2, .002), (3, .001)):
            graph.add_node(n, x=x, y=30)
        for u, v in ((1, 2), (2, 1), (2, 3), (3, 2)):
            graph.add_edge(u, v, coords=[[graph.nodes[u]['x'], 30], [graph.nodes[v]['x'], 30]])
        graph.graph.update(bounds={'west': -.001, 'east': .0015, 'south': 29.99, 'north': 30.01},
                           default=['base', 'base'], places=[{'id': 'base', 'name': 'Base', 'node': 1}])
        places, errors = attach_places(graph, [{'id': 'edge', 'name': 'Edge', 'category': 'Academic',
                                              'lat': 30, 'lon': .001, 'aliases': []}])
        self.assertEqual([p['id'] for p in places], ['base'])
        self.assertIn('No approach fully inside', errors[0]['reason'])
