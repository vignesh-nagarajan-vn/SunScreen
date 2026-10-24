import copy
import unittest
from unittest.mock import patch

import networkx as nx
from fastapi.testclient import TestClient

from campus_routing.passages import add_passages, load_catalog
from api import index


def fixture():
    graph = nx.MultiDiGraph(slots=['1400'])
    for node, x in [(1, 0), (2, 0.001), (3, 0.002), (4, 0.003)]:
        graph.add_node(node, x=x, y=30)
    for u, v in [(1, 2), (2, 3), (3, 4)]:
        for a, b in [(u, v), (v, u)]:
            graph.add_edge(a, b, length=100, shade=(0.0,),
                           coords=[[graph.nodes[a]['x'], 30], [graph.nodes[b]['x'], 30]])
    passage = {'id': 'test-hall', 'building': 'Test hall', 'enabled': True,
               'access': 'public', 'weekly_hours': '24/7', 'verification': 'Synthetic test fixture', 'sources': [],
               'doors': [{'node': 2, 'coordinates': [0.001, 30]},
                         {'node': 3, 'coordinates': [0.002, 30]}],
               'sections': [{'environment': 'indoor',
                             'coordinates': [[0.001, 30], [0.0015, 30]]},
                            {'environment': 'covered',
                             'coordinates': [[0.0015, 30], [0.002, 30]]}]}
    return graph, {'passages': [passage]}


class PassageOverlayTests(unittest.TestCase):
    def test_outdoor_indoor_outdoor_connection_and_reverse(self):
        graph, catalog = fixture()
        merged, reports = add_passages(graph, catalog)
        for a, b in [(1, 4), (4, 1)]:
            route = index.shortest(a, b, 0, 8, merged)
            self.assertGreater(route['indoor_m'], 0)
            self.assertGreater(route['covered_passage_m'], 0)
            self.assertEqual(route['coords'][0], [graph.nodes[a]['x'], 30])
            self.assertEqual(route['coords'][-1], [graph.nodes[b]['x'], 30])
        self.assertEqual(reports[0]['building'], 'Test hall')
        self.assertEqual(len(graph), 4)
        self.assertFalse(any(d.get('passage_id') for _, _, d in graph.edges(data=True)))

    def test_closed_and_restricted_passages_are_excluded(self):
        for restriction in ({'closed': True}, {'access': 'private'}, {'enabled': False}):
            graph, catalog = fixture()
            catalog['passages'][0].update(restriction)
            merged, reports = add_passages(graph, catalog)
            self.assertEqual(len(merged), len(graph))
            self.assertEqual(reports, [])

    def test_missing_door_is_rejected_instead_of_snapped(self):
        graph, catalog = fixture()
        catalog['passages'][0]['doors'][0]['node'] = 999
        merged, reports = add_passages(graph, catalog)
        self.assertEqual(reports, [])
        self.assertEqual(len(merged), len(graph))
        self.assertIn('outdoor connection', merged.graph['passage_diagnostics'][0]['reason'])

    def test_disconnected_geometry_is_rejected(self):
        graph, catalog = fixture()
        catalog['passages'][0]['sections'][1]['coordinates'][0] = [0.0018, 30]
        merged, reports = add_passages(graph, catalog)
        self.assertEqual(reports, [])
        self.assertEqual(len(merged), len(graph))
        self.assertIn('continuously', merged.graph['passage_diagnostics'][0]['reason'])

    def test_existing_canopy_retains_geometry_and_does_not_mutate_base(self):
        graph, _ = fixture()
        original = copy.deepcopy(graph[2][3][0])
        catalog = {'passages': [], 'covered_walkways': [{
            'id': 'canopy', 'name': 'Covered outdoors', 'enabled': True, 'edges': [[2, 3]],
            'verification': 'Synthetic canopy', 'sources': []}]}
        merged, _ = add_passages(graph, catalog)
        edge = merged[2][3][0]
        self.assertEqual(edge['coords'], original['coords'])
        self.assertEqual(edge['environment'], 'covered')
        self.assertEqual(edge['shade'], (1.0,))
        self.assertEqual(graph[2][3][0], original)


class CampusRouteTests(unittest.TestCase):
    def setUp(self):
        self.weather = patch.object(index, 'weather_at', return_value={
            'source': 'fixed test weather', 'cloud_cover_pct': 0, 'sun_strength_pct': 100})
        self.weather.start()
        self.addCleanup(self.weather.stop)

    def test_normal_trip_always_has_exactly_three_choices(self):
        before = (index.G.number_of_nodes(), index.G.number_of_edges())
        result = index.route('14:00')
        self.assertEqual([f['properties']['id'] for f in result['features']],
                         ['fastest', 'recommended', 'max_shade'])
        self.assertIn('langford-a-ground-pass-through', result['building_routing']['available_passages'])
        self.assertEqual(before, (index.G.number_of_nodes(), index.G.number_of_edges()))

    def test_normal_search_can_select_langford_without_extra_option(self):
        result = index.route('14:00', src='30.6185753,-96.3375308', dst='30.6189529,-96.337867')
        self.assertEqual(len(result['features']), 3)
        for feature in result['features']:
            p = feature['properties']
            self.assertGreater(p['indoor_m'], 0)
            self.assertIn('Langford A', p['via_buildings'])
            self.assertEqual(p['shaded_pct'], 100)

    def test_adding_passages_keeps_outdoor_candidates(self):
        with patch.object(index, 'PASSAGES', {'passages': [], 'covered_walkways': []}):
            baseline = index.route('14:00')
        result = index.route('14:00')
        for old, new in zip(baseline['features'], result['features']):
            self.assertGreaterEqual(new['properties']['shaded_pct'], old['properties']['shaded_pct'])

    def test_api_requires_no_building_setting(self):
        client = TestClient(index.app)
        response = client.get('/api/route', params={'from': 'commons', 'to': 'zachry', 'time': '14:00'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['features']), 3)
        self.assertNotIn('building_passages', [p['name'] for p in client.get('/openapi.json').json()['paths']['/api/route']['get']['parameters']])

    def test_stale_catalog_falls_back_without_breaking_navigation(self):
        catalog = copy.deepcopy(load_catalog())
        catalog['passages'][0]['doors'][0]['node'] = -999
        with patch.object(index, 'PASSAGES', catalog):
            response = TestClient(index.app).get('/api/route')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['features']), 3)
        self.assertNotIn('langford-a-ground-pass-through', response.json()['building_routing']['available_passages'])
        self.assertGreater(len(response.json()['building_routing']['available_passages']), 0)

    def test_offline_default_trip_has_only_three_choices(self):
        import json
        from pathlib import Path
        slots = json.loads(Path('app/fallback.json').read_text(encoding='utf-8'))
        self.assertEqual(len(slots), 27)
        for data in slots.values():
            self.assertEqual([f['properties']['id'] for f in data['features']],
                             ['fastest', 'recommended', 'max_shade'])
            self.assertTrue(data['offline']['door_dependent_passages_excluded'])
            self.assertTrue(all(f['properties']['indoor_m'] == 0 for f in data['features']))


if __name__ == '__main__':
    unittest.main()
