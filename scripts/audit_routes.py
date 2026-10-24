"""Place-pair audit at 14:00 plus the default trip at every slot, or all pairs/slots.

Uses fixed weather, not a network service. Fails on invalid metrics, geometry,
detour limits or route IDs. Saves a machine-readable validation report.
"""
import json
import argparse
import math
import sys
import time
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ProcessPoolExecutor, as_completed

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api import index
from fastapi import HTTPException


def check(data):
    assert [f['properties']['id'] for f in data['features']] == ['fastest', 'recommended', 'max_shade']
    base = data['features'][0]['properties']['distance_m']
    endpoints = None
    for i, feature in enumerate(data['features']):
        p, coords = feature['properties'], feature['geometry']['coordinates']
        assert len(coords) >= 2
        for lon, lat in coords:
            assert math.isfinite(lon) and math.isfinite(lat)
            assert index.B['west'] - 0.00001 <= lon <= index.B['east'] + 0.00001
            assert index.B['south'] - 0.00001 <= lat <= index.B['north'] + 0.00001
        ends = coords[0], coords[-1]
        if endpoints is None:
            endpoints = ends
        assert endpoints == ends
        assert 0 <= p['shaded_pct'] <= 100 and p['sun_min'] >= 0
        assert p['time_min'] >= 0 and p['distance_m'] > 0
        assert p['indoor_m'] + p['covered_passage_m'] <= p['distance_m'] + 1
        assert p['distance_m'] <= base * [1, 1.1, 1.3][i] + 2
        for a, b, shade in p['runs']:
            assert 0 <= a < b < len(coords) and 0 <= shade <= 1


def audit_cases(cases):
    report = {'cases': len(cases), 'passed': 0, 'unroutable': [], 'failures': [], 'building_routes': 0}
    with patch.object(index, 'weather_at', return_value={
            'source': 'audit clear sky', 'sun_strength_pct': 100, 'cloud_cover_pct': 0}):
        for i, (a, b, slot) in enumerate(cases):
            try:
                result = index.route(slot, a, b)
                check(result)
                report['passed'] += 1
                report['building_routes'] += sum(bool(f['properties']['building_runs']) for f in result['features'])
            except HTTPException as exc:
                if exc.status_code == 400 and ('same spot' in exc.detail or 'No walking path' in exc.detail):
                    report['unroutable'].append({'from': a, 'to': b, 'reason': exc.detail})
                else:
                    report['failures'].append({'from': a, 'to': b, 'time': slot, 'error': str(exc)})
            except Exception as exc:
                report['failures'].append({'from': a, 'to': b, 'time': slot, 'error': repr(exc)})
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all-slots', action='store_true')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    started = time.perf_counter()
    pairs = [(a, b) for a in index.PLACES for b in index.PLACES if a != b]
    if args.all_slots:
        batches = [[(a, b, f'{s[:2]}:{s[2:]}') for a, b in pairs] for s in index.SLOTS]
    else:
        batches = [[(a, b, '14:00') for a, b in pairs],
                   [(index.DEFAULT[0], index.DEFAULT[1], f'{s[:2]}:{s[2:]}') for s in index.SLOTS]]
    report = {'cases': 0, 'passed': 0, 'unroutable': [], 'failures': [], 'building_routes': 0}
    with ProcessPoolExecutor(max_workers=max(1, min(4, args.workers))) as pool:
        for future in as_completed([pool.submit(audit_cases, batch) for batch in batches]):
            result = future.result()
            for field in ('cases', 'passed', 'building_routes'):
                report[field] += result[field]
            for field in ('unroutable', 'failures'):
                report[field].extend(result[field])
            print(f"Audited {report['cases']} trips; failures {len(report['failures'])}", flush=True)
    report['seconds'] = round(time.perf_counter() - started, 2)
    target = Path('tmp/reports/campus-routing.json'); target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)
    raise SystemExit(bool(report['failures']))
