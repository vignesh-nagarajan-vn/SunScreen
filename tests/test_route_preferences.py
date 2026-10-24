import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import networkx as nx

from api import index
from api.lighting import routes as lit_routes


class RoutePreferenceTests(unittest.TestCase):
    def setUp(self):
        self.weather = patch.object(index, 'weather_at', return_value={'sun_strength_pct': 100})
        self.weather.start()
        self.addCleanup(self.weather.stop)

    def test_defaults_keep_the_previous_routes(self):
        for mode in ('shade', 'lighting'):
            with self.subTest(mode=mode):
                self.assertEqual(index.route(mode=mode), index.route(mode=mode, recommended_pct=10, max_detour_pct=30))

    def test_limits_constrain_both_modes_and_do_not_change_fastest(self):
        for mode in ('shade', 'lighting'):
            baseline = index.route(mode=mode)
            for rec, maximum in ((0, 0), (0, 30), (30, 30), (50, 100), (100, 100)):
                with self.subTest(mode=mode, rec=rec, maximum=maximum):
                    result = index.route(mode=mode, recommended_pct=rec, max_detour_pct=maximum)
                    self.assertEqual(result['features'][0], baseline['features'][0])
                    length = result['features'][0]['properties']['distance_m']
                    for feature, limit in zip(result['features'], (0, rec, maximum)):
                        self.assertLessEqual(feature['properties']['distance_m'], length * (1 + limit / 100) + 2)
                    self.assertEqual(result['route_limits']['recommended_pct'], rec)
                    self.assertEqual(len(result['features']), 3)

    def test_weather_still_reduces_only_daytime_recommended_allowance(self):
        for strength in (0, 20, 100):
            with patch.object(index, 'weather_at', return_value={'sun_strength_pct': strength}):
                result = index.route(recommended_pct=30, max_detour_pct=60)
            self.assertEqual(result['route_limits']['effective_recommended_pct'], 30 * strength / 100)
            fastest = result['features'][0]['properties']['distance_m']
            self.assertLessEqual(result['features'][1]['properties']['distance_m'], fastest * (1 + .3 * strength / 100) + 2)
        self.assertEqual(index.route(mode='lighting', recommended_pct=30)['route_limits']['effective_recommended_pct'], 30)

    def test_invalid_or_inverted_limits_are_client_errors(self):
        client = TestClient(index.app)
        for mode in ('shade', 'lighting'):
            for limits in ({'recommended_pct': -1}, {'max_detour_pct': 101}, {'recommended_pct': 'nan'},
                           {'max_detour_pct': 'inf'}, {'recommended_pct': 'abc'}, {'recommended_pct': 40, 'max_detour_pct': 30}):
                with self.subTest(mode=mode, limits=limits):
                    response = client.get('/api/route', params={'mode': mode, **limits})
                    self.assertIn(response.status_code, (400, 422))

    def test_custom_api_response_echoes_applied_limits(self):
        response = TestClient(index.app).get('/api/route?recommended_pct=25&max_detour_pct=60')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['route_limits'], {
            'recommended_pct': 25, 'max_detour_pct': 60, 'effective_recommended_pct': 25})

    def test_settings_change_shade_choice_in_a_controlled_network(self):
        # Two equal-sun endpoints: direct 100 m in sun, detour 120 m in shade.
        graph = nx.MultiDiGraph(slots=['1400'])
        for n, x in ((1, 0), (2, .001), (3, .0005)):
            graph.add_node(n, x=x, y=30)
        for a, b, length, shade in ((1, 2, 100, 0), (1, 3, 60, 1), (3, 2, 60, 1)):
            graph.add_edge(a, b, length=length, shade=(shade,), coords=[[graph.nodes[a]['x'], 30], [graph.nodes[b]['x'], 30]])
        def endpoint(value, label):
            n = int(value)
            return {'node': n, 'id': value, 'name': label, 'lat': 30, 'lon': graph.nodes[n]['x']}
        with patch.object(index, 'G', graph), patch.object(index, 'SLOTS', ['1400']), \
             patch.object(index, 'PASSAGES', {}), patch.object(index, 'endpoint', side_effect=endpoint):
            default = index.route('14:00', '1', '2')
            custom = index.route('14:00', '1', '2', recommended_pct=30)
        self.assertEqual(default['features'][1]['properties']['distance_m'], 100)
        self.assertEqual(custom['features'][1]['properties']['distance_m'], 120)

    def test_settings_change_lighting_choice_in_a_controlled_network(self):
        graph = nx.MultiDiGraph()
        for a, b, length, state in ((1, 2, 100, 'unlit'), (1, 3, 60, 'mapped'), (3, 2, 60, 'mapped')):
            graph.add_edge(a, b, length=length, coords=[[a * .001, 30], [b * .001, 30]],
                           lighting={state: 1, 'runs': [[0, 1, state]]})
        before, _, _ = lit_routes(graph, 1, 2, 1.4)
        after, _, _ = lit_routes(graph, 1, 2, 1.4, .3, .3)
        self.assertEqual(before[1]['properties']['distance_m'], 100)
        self.assertEqual(after[1]['properties']['distance_m'], 120)
