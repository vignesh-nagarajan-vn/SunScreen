import copy
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from api import index
from campus_routing.geometry import fingerprint, inside, line_overlap, polygon_overlap, route_key
from campus_routing.passages import TZ, add_passages, available, load_catalog, traversal_available
from test_building_passages import fixture


def at(value):
    return datetime.fromisoformat(value).replace(tzinfo=TZ)


class AvailabilityTests(unittest.TestCase):
    def record(self, **extra):
        return dict(enabled=True, access='public', weekly_hours={'mon': [['08:00', '17:00']]}, **extra)

    def test_open_and_closed_boundaries(self):
        r = self.record()
        for t, expected in [('07:59:59', False), ('08:00:00', True), ('16:59:59', True), ('17:00:00', False)]:
            with self.subTest(t=t):
                self.assertEqual(available(r, at('2026-10-26T' + t)), expected)
        self.assertFalse(available(r, at('2026-10-26T16:59:00'), at('2026-10-26T17:00:01')))
        self.assertTrue(available(r, at('2026-10-26T16:59:00'), at('2026-10-26T17:00:00')))

    def test_overnight_windows_belong_to_previous_day(self):
        r = self.record(); r['weekly_hours'] = {'mon': [['22:00', '02:00']]}
        self.assertTrue(available(r, at('2026-10-27T01:00:00')))
        self.assertFalse(available(r, at('2026-10-27T02:00:00')))
        self.assertFalse(available(r, at('2026-10-28T01:00:00')))

    def test_midnight_adjacent_windows_and_holidays(self):
        r = self.record(); r['weekly_hours'] = {'mon': [['22:00', '24:00']], 'tue': [['00:00', '03:00']]}
        self.assertTrue(available(r, at('2026-10-26T23:30:00'), at('2026-10-27T00:30:00')))
        r['closed_dates'] = ['2026-10-27']
        self.assertFalse(available(r, at('2026-10-26T23:30:00'), at('2026-10-27T00:30:00')))

    def test_unknown_hours_are_never_silently_open(self):
        r = self.record(); r.pop('weekly_hours')
        self.assertFalse(available(r, at('2026-10-26T14:00:00')))
        r['unknown_hours_policy'] = 'allow_with_notice'
        self.assertTrue(available(r, at('2026-10-26T14:00:00')))

    def test_closure_restriction_and_expiry_override_hours(self):
        for updates in ({'closed': True}, {'access': 'private'}, {'enabled': False},
                        {'valid_until': '2026-10-25'}, {'closed_dates': ['2026-10-26']}):
            with self.subTest(updates=updates):
                r = self.record(); r.update(updates)
                self.assertFalse(available(r, at('2026-10-26T14:00:00')))

    def test_malformed_hours_fail_closed(self):
        for hours in ([], 'sometimes', {'mon': [['25:00', '26:00']]},
                      {'mon': [['09:00']]}, {'bad': []}, {'mon': [['08:00', '08:00']]}):
            r = self.record(); r['weekly_hours'] = hours
            with self.subTest(hours=hours), self.assertRaises((ValueError, TypeError)):
                available(r, at('2026-10-26T14:00:00'))

    def test_dst_uses_campus_timezone(self):
        r = self.record(); r['weekly_hours'] = {'sun': [['01:00', '03:00']]}
        from datetime import timezone
        # Both occurrences of 01:30 during the autumn transition are in range.
        self.assertTrue(available(r, datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)))
        self.assertTrue(available(r, datetime(2026, 11, 1, 7, 30, tzinfo=timezone.utc)))


class GeometryTests(unittest.TestCase):
    def test_crossing_and_parallel_paths_do_not_match_by_proximity(self):
        base = [[0, 30], [0.001, 30]]
        self.assertEqual(line_overlap(base, [[0.0005, 29.9995], [0.0005, 30.0005]]), [])
        self.assertEqual(line_overlap(base, [[0, 30.00001], [0.001, 30.00001]]), [])

    def test_partial_match_and_reversed_geometry(self):
        base = [[0, 30], [0.001, 30]]
        source = [[0.0002, 30], [0.0006, 30]]
        self.assertAlmostEqual(line_overlap(base, source)[0][0], 0.2, places=6)
        reverse = line_overlap(list(reversed(base)), source)[0]
        self.assertAlmostEqual(reverse[0], 0.4, places=6)
        self.assertAlmostEqual(reverse[1], 0.8, places=6)

    def test_roof_clips_only_inside_polygon(self):
        polygon = [[0.0002, 29.999], [0.0006, 29.999], [0.0006, 30.001], [0.0002, 30.001]]
        self.assertTrue(inside([0.0004, 30], polygon))
        self.assertEqual(polygon_overlap([[0, 30], [0.001, 30]], polygon), [[0.2, 0.6]])

    def test_split_points_do_not_create_a_fake_different_route(self):
        self.assertEqual(route_key([[0, 30], [0.001, 30]]),
                         route_key([[0, 30], [0.0004, 30], [0.001, 30]]))
        self.assertNotEqual(route_key([[0, 30], [0.001, 30]]),
                            route_key([[0, 30], [0.0004, 30.0001], [0.001, 30]]))


class AtomicOverlayTests(unittest.TestCase):
    def test_one_bad_record_does_not_disable_good_records(self):
        g, c = fixture(); bad = copy.deepcopy(c['passages'][0]); bad['id'] = 'bad'; bad['doors'][0]['node'] = 999
        c['passages'].insert(0, bad)
        merged, reports = add_passages(g, c)
        self.assertEqual([r['id'] for r in reports], ['test-hall'])
        self.assertEqual(len(merged.graph['passage_diagnostics']), 1)

    def test_invalid_last_section_leaves_no_partial_corridor(self):
        g, c = fixture(); c['passages'][0]['sections'][-1]['coordinates'][-1] = [0.005, 30]
        merged, reports = add_passages(g, c)
        self.assertEqual(reports, [])
        self.assertEqual(set(merged.nodes), set(g.nodes))
        self.assertEqual(merged.number_of_edges(), g.number_of_edges())

    def test_duplicate_ids_do_not_add_duplicate_corridors(self):
        g, c = fixture(); c['passages'].append(copy.deepcopy(c['passages'][0]))
        merged, reports = add_passages(g, c)
        self.assertEqual(len(reports), 1)
        self.assertEqual(len(merged.graph['passage_diagnostics']), 1)

    def test_one_way_passage_does_not_create_reverse_shortcut(self):
        g, c = fixture(); c['passages'][0]['oneway'] = True
        merged, _ = add_passages(g, c)
        self.assertGreater(index.shortest(1, 4, 0, 8, merged)['indoor_m'], 0)
        self.assertEqual(index.shortest(4, 1, 0, 8, merged)['indoor_m'], 0)

    def test_geometry_and_type_errors_are_isolated(self):
        for coord in ([float('nan'), 30], [float('inf'), 30], [181, 30], [0, 91], [True, 30], ['x', 30], [0]):
            g, c = fixture(); c['passages'][0]['sections'][0]['coordinates'][0] = coord
            with self.subTest(coord=coord):
                merged, reports = add_passages(g, c)
                self.assertEqual(reports, [])
                self.assertEqual(len(merged), len(g))

    def test_nonfinite_door_cannot_bypass_graph_anchor_validation(self):
        g, c = fixture()
        c['passages'][0]['doors'][0]['coordinates'] = [float('nan'), 30]
        c['passages'][0]['sections'][0]['coordinates'][0] = [0.01, 30]
        merged, reports = add_passages(g, c)
        self.assertEqual(reports, [])
        self.assertEqual(merged.number_of_edges(), g.number_of_edges())

    def test_partial_roof_preserves_distance_and_does_not_shade_whole_edge(self):
        g, _ = fixture(); old = g[2][3][0]
        canopy = {'id': 'roof', 'name': 'Roof', 'enabled': True, 'sources': [], 'edges': [{
            'u': 2, 'v': 3, 'key': 0, 'ranges': [[0.2, 0.6]], 'geometry_sha256': fingerprint(old['coords'])}]}
        merged, _ = add_passages(g, {'passages': [], 'covered_walkways': [canopy]})
        path = index.shortest(2, 3, 0, 0, merged)
        self.assertAlmostEqual(path['length'], 100)
        self.assertAlmostEqual(path['covered_passage_m'], 40)
        self.assertAlmostEqual(path['shade'], 0.4)
        self.assertEqual(g[2][3][0]['shade'], (0.0,))

    def test_parallel_edge_is_not_painted_by_another_edges_roof(self):
        g, _ = fixture(); g.add_edge(2, 3, key=1, **copy.deepcopy(g[2][3][0]))
        canopy = {'id': 'roof', 'name': 'Roof', 'enabled': True, 'edges': [{
            'u': 2, 'v': 3, 'key': 0, 'ranges': [[0, 1]], 'geometry_sha256': fingerprint(g[2][3][0]['coords'])}]}
        merged, _ = add_passages(g, {'passages': [], 'covered_walkways': [canopy]})
        self.assertEqual(merged[2][3][1]['shade'], (0.0,))
        self.assertEqual(merged[2][3][0]['shade'], (1.0,))

    def test_collapsed_roof_slices_are_rejected_without_partial_mutation(self):
        for ranges in ([[0.2, 0.20000000000001]], [[0.00000000000001, 0.6]]):
            g, c = fixture()
            c['covered_walkways'] = [{'id': 'tiny', 'name': 'Roof', 'enabled': True, 'edges': [{
                'u': 2, 'v': 3, 'key': 0, 'ranges': ranges,
                'geometry_sha256': fingerprint(g[2][3][0]['coords'])}]}]
            merged, reports = add_passages(g, c)
            self.assertEqual([r['id'] for r in reports], ['test-hall'])
            self.assertEqual(merged[2][3][0]['shade'], (0.0,))
            self.assertEqual(len(merged.graph['passage_diagnostics']), 1)

    def test_arrival_after_closing_rejects_candidate(self):
        g, c = fixture(); c['passages'][0]['weekly_hours'] = {'mon': [['08:00', '17:00']]}
        departure = at('2026-10-26T16:59:30')
        merged, _ = add_passages(g, c, departure)
        path = index.shortest(1, 4, 0, 8, merged)
        self.assertFalse(traversal_available(path, merged, departure))

    def test_missing_or_broken_catalog_is_safe(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'missing.json'
            self.assertTrue(load_catalog(path)['errors'])
            for raw in ('bad json', '[]', '{"passages":null}'):
                path.write_text(raw)
                self.assertTrue(load_catalog(path)['errors'])


class ApiInputTests(unittest.TestCase):
    def test_building_can_connect_disconnected_outdoor_components(self):
        g, catalog = fixture()
        g.remove_edge(2, 3, 0); g.remove_edge(3, 2, 0)
        def endpoint(value, label):
            n = int(value)
            return {'node': n, 'id': value, 'name': label, 'lon': g.nodes[n]['x'], 'lat': 30}
        with patch.object(index, 'G', g), patch.object(index, 'SLOTS', ['1400']), \
             patch.object(index, 'PASSAGES', catalog), patch.object(index, 'endpoint', side_effect=endpoint), \
             patch.object(index, 'weather_at', return_value={'source': 'test', 'sun_strength_pct': 100}):
            result = index.route('14:00', '1', '4')
        self.assertEqual(len(result['features']), 3)
        self.assertTrue(all(f['properties']['indoor_m'] > 0 for f in result['features']))

    def test_route_that_arrives_after_closing_uses_outdoor_alternative(self):
        g, catalog = fixture()
        catalog['passages'][0]['weekly_hours'] = {'mon': [['08:00', '17:00']]}
        def endpoint(value, label):
            n = int(value)
            return {'node': n, 'id': value, 'name': label, 'lon': g.nodes[n]['x'], 'lat': 30}
        with patch.object(index, 'G', g), patch.object(index, 'SLOTS', ['1400']), \
             patch.object(index, 'PASSAGES', catalog), patch.object(index, 'endpoint', side_effect=endpoint), \
             patch.object(index, 'departure_for_slot', return_value=at('2026-10-26T16:59:30')), \
             patch.object(index, 'weather_at', return_value={'source': 'test', 'sun_strength_pct': 100}):
            result = index.route('14:00', '1', '4')
        self.assertTrue(all(f['properties']['indoor_m'] == 0 for f in result['features']))

    def test_concurrent_requests_do_not_mutate_the_saved_graph(self):
        from concurrent.futures import ThreadPoolExecutor
        import hashlib
        def digest():
            return hashlib.sha256(json.dumps(list(index.G.edges(keys=True, data=True)), sort_keys=True).encode()).hexdigest()
        before = digest()
        with patch.object(index, 'weather_at', return_value={'source': 'test', 'sun_strength_pct': 100}):
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(lambda _: index.route('14:00'), range(18)))
        self.assertEqual(before, digest())
        self.assertTrue(all(len(r['features']) == 3 for r in results))

    def test_all_bundled_records_compile_without_errors(self):
        network, reports = add_passages(index.G, index.PASSAGES, at('2026-10-26T14:00:00'))
        self.assertEqual(network.graph['passage_diagnostics'], [])
        self.assertEqual(len(reports), len(index.PASSAGES['passages']) + len(index.PASSAGES['covered_walkways']))

    def test_bad_times_and_coordinates_are_client_errors(self):
        client = TestClient(index.app)
        for value in ('99:00', '12:99', '-1:00', 'bad', '24:00', '7:5'):
            with self.subTest(value=value):
                response = client.get('/api/route', params={'time': value})
                self.assertIn(response.status_code, (400, 422))
        for value in ('nan,nan', 'inf,30', '0,0', 'missing', '30,40,50'):
            with self.subTest(value=value):
                self.assertEqual(client.get('/api/route', params={'from': value}).status_code, 400)

    def test_same_spot_is_rejected(self):
        self.assertEqual(TestClient(index.app).get('/api/route?from=commons&to=commons').status_code, 400)

    def test_half_hour_tie_matches_phone_slider(self):
        self.assertEqual(index.nearest_slot('07:15'), '0730')

    def test_malformed_weather_does_not_break_routing(self):
        with patch.object(index, 'hourly_weather', return_value={'cloud_cover': [None] * 24,
                'direct_normal_irradiance_instant': [None] * 24}):
            weather = index.weather_at('1400')
        self.assertEqual(weather['sun_strength_pct'], 100)
        self.assertIn('unavailable', weather['source'])


if __name__ == '__main__':
    unittest.main()
