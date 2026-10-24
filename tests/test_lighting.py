import copy
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import networkx as nx
import httpx
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from api import index
from api.lighting import routes, slice_line
from pipeline import lighting_sources

spec = importlib.util.spec_from_file_location("lighting_pipeline", ROOT / "pipeline/05_lighting.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


def edge(graph, u, v, length, state=None):
    coords = [[-96.34 + u * 0.0001, 30.61], [-96.34 + v * 0.0001, 30.61]]
    data = {"length": length, "coords": coords, "shade": [1.0] * len(index.SLOTS)}
    if state:
        data["lighting"] = {state: 1.0, "runs": [[0, 1, state]]}
    graph.add_edge(u, v, **data)


class RoutingTests(unittest.TestCase):
    def test_lit_detour_and_independent_limits(self):
        graph = nx.MultiDiGraph()
        edge(graph, 0, 1, 100, "unlit")
        edge(graph, 0, 2, 54, "mapped")
        edge(graph, 2, 1, 54, "mapped")
        features, _, status = routes(graph, 0, 1, 1.4)
        self.assertEqual(status, "available")
        self.assertEqual(features[0]["properties"]["distance_m"], 100)
        self.assertEqual(features[1]["properties"]["distance_m"], 108)
        self.assertEqual(features[1]["properties"]["lit_pct"], 100)
        # A 20% detour is available only to Most lit.
        for u, v in [(0, 2), (2, 1)]:
            graph[u][v][0]["length"] = 60
        features, _, _ = routes(graph, 0, 1, 1.4)
        self.assertEqual(features[1]["properties"]["distance_m"], 100)
        self.assertEqual(features[2]["properties"]["distance_m"], 120)

    def test_unknown_is_not_unlit_and_does_not_invent_a_detour(self):
        graph = nx.MultiDiGraph()
        edge(graph, 0, 1, 100)
        features, _, status = routes(graph, 0, 1, 1.4)
        self.assertEqual(status, "insufficient_data")
        for feature in features:
            p = feature["properties"]
            self.assertEqual(p["unknown_pct"], 100)
            self.assertEqual(p["unlit_pct"], 0)
            self.assertEqual(p["lit_pct"], 0)
            self.assertTrue(p["same_as_fastest"])

    def test_gap_continues_across_edges(self):
        graph = nx.MultiDiGraph()
        edge(graph, 0, 1, 30, "unknown")
        edge(graph, 1, 2, 40, "unlit")
        edge(graph, 2, 3, 50, "mapped")
        features, _, _ = routes(graph, 0, 3, 1.4)
        self.assertEqual(features[0]["properties"]["longest_uncertain_gap_m"], 70)

    def test_parallel_edges_use_lighting_and_report_real_edge(self):
        graph = nx.MultiDiGraph()
        edge(graph, 0, 1, 100, "unlit")
        edge(graph, 0, 1, 105, "estimated")
        features, _, _ = routes(graph, 0, 1, 1.4)
        self.assertEqual(features[1]["properties"]["estimated_lit_pct"], 100)
        self.assertFalse(features[1]["properties"]["same_as_fastest"])

    def test_slice_preserves_direction_and_intermediate_vertex(self):
        coords = [[-96.34, 30.61], [-96.339, 30.61], [-96.338, 30.61]]
        result = slice_line(coords, .25, .75)
        self.assertEqual(len(result), 3)
        self.assertLess(result[0][0], result[-1][0])
        self.assertAlmostEqual(result[0][0], -96.3395)

    def test_night_never_calls_weather_or_uses_shade(self):
        with patch.object(index, "weather_at", side_effect=AssertionError("Night fetched weather")):
            result = index.route(mode="lighting", time="23:30")
        self.assertEqual(result["mode"], "lighting")
        self.assertNotIn("weather", result)
        self.assertNotIn("shaded_pct", result["features"][0]["properties"])

    def test_day_results_do_not_depend_on_lighting(self):
        with patch.object(index, "weather_at", return_value={"sun_strength_pct": 100}):
            before = index.route()
            graph = copy.deepcopy(index.G)
            for _, _, data in graph.edges(data=True):
                data["lighting"] = {"unlit": 1, "runs": [[0, 1, "unlit"]]}
            with patch.object(index, "G", graph):
                after = index.route(mode="shade")
        self.assertEqual(before, after)

    def test_api_mode_validation_and_default(self):
        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=index.app), base_url="http://test") as client:
                self.assertEqual((await client.get("/api/route?mode=bad")).status_code, 422)
                self.assertEqual((await client.get("/api/route")).json()["mode"], "shade")
                night = await client.get("/api/route?mode=lighting&time=23:00")
                self.assertEqual(night.status_code, 200)
                self.assertEqual(night.json()["mode"], "lighting")
        with patch.object(index, "weather_at", return_value={"sun_strength_pct": 100}):
            asyncio.run(check())


class PipelineTests(unittest.TestCase):
    def test_cache_is_reused_only_for_the_same_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            area = {"bbox_wgs84": [-96.36, 30.59, -96.33, 30.63]}
            with patch.object(pipeline, "request", return_value=b'{"elements": []}') as download:
                pipeline.fetch(area, folder)
                pipeline.fetch(area, folder)
                self.assertEqual(download.call_count, 1)
                pipeline.fetch({"bbox_wgs84": [-96.37, 30.59, -96.33, 30.63]}, folder)
                self.assertEqual(download.call_count, 2)

    def test_no_lamp_evidence_stays_unknown(self):
        self.assertEqual(pipeline.classify(Point(0, 0), STRtree([]), STRtree([]), [], 15), "unknown")

    def test_lamp_radius_and_conflicting_tags(self):
        lamps = STRtree([Point(0, 0)])
        empty = STRtree([])
        self.assertEqual(pipeline.classify(Point(10, 0), lamps, empty, [], 15), "estimated")
        self.assertEqual(pipeline.classify(Point(20, 0), lamps, empty, [], 15), "unknown")
        way = STRtree([LineString([(-10, 0), (10, 0)])])
        self.assertEqual(pipeline.classify(Point(0, 0), lamps, way, ["unlit"], 15), "conflict")

    def test_closed_and_broken_lamps_are_not_assumed_on(self):
        elements = [{"type": "node", "id": i, "lat": 0, "lon": i,
                     "tags": {"highway": "street_lamp", **tags}}
                    for i, tags in enumerate([{}, {"disused": "yes"}, {"light:lit": "no"}, {"opening_hours": "Mo-Fr 18:00-20:00"}])]
        lamps, _, features = pipeline.normalize(elements, lambda x, y: (x, y))
        self.assertEqual(len(lamps), 1)
        self.assertEqual(len(features), 4)

    def test_xml_extract_has_way_geometry_and_tags(self):
        raw = b'<osm><node id="1" lat="30" lon="-96"/><node id="2" lat="30.1" lon="-96"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/><tag k="lit" v="yes"/></way></osm>'
        elements = pipeline.read_elements(raw)
        self.assertEqual(elements[-1]["tags"]["lit"], "yes")
        self.assertEqual(len(elements[-1]["geometry"]), 2)

    def test_incomplete_download_is_rejected(self):
        with self.assertRaises(ValueError):
            pipeline.read_elements(json.dumps({"elements": [], "remark": "timeout"}).encode())

    def test_sampling_records_unknown_separately(self):
        graph = nx.MultiDiGraph()
        edge(graph, 0, 1, 100)
        coverage = pipeline.annotate(graph, [], [], lambda x, y: (x * 100000, y * 100000), 15)
        self.assertEqual(coverage["unknown"], 1)
        self.assertEqual(graph[0][1][0]["lighting"]["unlit"], 0)


class CampusSourceTests(unittest.TestCase):
    def snapshot(self, source_index, features):
        return {"source": lighting_sources.SOURCES[source_index],
                "request": {"bbox": [-100, -80, 100, 80]}, "features": features,
                "retrieved_at": "2026-10-24T00:00:00+00:00", "layer_updated_ms": 0,
                "terms": "public access; license unspecified"}

    def record(self, oid, x, y, **attributes):
        return {"geometry": {"x": x, "y": y}, "attributes": {"FID": oid, "ObjectId": oid, **attributes}}

    def test_inventory_excludes_removed_and_signs_not_unknown_status(self):
        snapshot = self.snapshot(0, [self.record(1, 0, 0, Status="Removed"),
                                    self.record(2, 10, 0, Pole_Use=" Sign "),
                                    self.record(3, 20, 0, Status=" ")])
        accepted, removed, excluded = lighting_sources.normalize_source(snapshot, lambda x, y: (x, y))
        self.assertEqual(len(accepted), 1)
        self.assertEqual(len(removed), 1)
        self.assertEqual(excluded, {"non_existing": 1, "sign_only": 1})
        self.assertIn("operation unknown", accepted[0]["feature"]["properties"]["reported_status"])

    def test_points_outside_requested_area_are_rejected(self):
        snapshot = self.snapshot(0, [self.record(1, -120, 30), self.record(2, float("nan"), 10)])
        accepted, _, excluded = lighting_sources.normalize_source(snapshot, lambda x, y: (x, y))
        self.assertFalse(accepted)
        self.assertEqual(excluded["invalid_geometry"], 2)

    def test_historical_failed_inspection_does_not_become_darkness(self):
        snapshot = self.snapshot(1, [self.record(1, 0, 0, field_15="choice1", field_51="choice7"),
                                    self.record(2, 10, 0, field_15="choice0", field_51="choice7")])
        accepted, removed, excluded = lighting_sources.normalize_source(snapshot, lambda x, y: (x, y))
        self.assertEqual(len(accepted), 1)
        self.assertFalse(removed)
        self.assertEqual(excluded["survey_not_passed"], 1)
        self.assertIn("historical", accepted[0]["feature"]["properties"]["reported_status"])

    def test_merge_deduplicates_sources_and_removed_inventory_wins(self):
        inventory = self.snapshot(0, [self.record(1, 0, 0), self.record(2, 20, 0, Status="Removed")])
        survey = self.snapshot(1, [self.record(1, 1, 0, field_15="choice0", field_51="choice7"),
                                  self.record(2, 10, 0, field_15="choice0", field_51="choice7"),
                                  self.record(3, 20, 1, field_15="choice0", field_51="choice7")])
        points, features, _, counts = lighting_sources.merge_lamps([Point(0, 0), Point(50, 0)], [inventory, survey], lambda x, y: (x, y))
        self.assertEqual(len(points), 3)
        self.assertEqual(counts, {"tamu_streetlight": 1, "tamu_survey": 1, "osm": 1})
        self.assertEqual(len(features), 2)

    def test_partial_arcgis_snapshot_cannot_replace_cache(self):
        source = lighting_sources.SOURCES[0]
        responses = [{"geometryType": "esriGeometryPoint"}, {"objectIds": [1, 2]},
                     {"features": [self.record(1, -96.34, 30.61)]}]
        with tempfile.TemporaryDirectory() as directory, patch.object(lighting_sources, "query", side_effect=responses):
            with self.assertRaises(ValueError):
                lighting_sources.fetch_source(source, {"bbox_wgs84": [-96.35, 30.60, -96.33, 30.62]}, directory)
            self.assertFalse((Path(directory) / "tamu_streetlight.json").exists())

    def test_only_lamp_fields_are_requested(self):
        for source in lighting_sources.SOURCES:
            fields = source["fields"].lower()
            for forbidden in ("phone", "email", "creator", "inspector", "comments", "panelassoc", "feeder"):
                self.assertNotIn(forbidden, fields)


if __name__ == "__main__":
    unittest.main()
