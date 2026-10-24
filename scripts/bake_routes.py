"""Bake safe offline defaults: public outdoor/covered ways, no door-dependent paths."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api import index


def bake():
    always_public = [r for r in index.PASSAGES.get('covered_walkways', [])
                     if r.get('weekly_hours') == '24/7' and r.get('access') == 'public'
                     and not r.get('closed') and not r.get('closed_dates') and not r.get('valid_until')]
    catalog = dict(index.PASSAGES, passages=[], covered_walkways=always_public)
    def weather(slot):
        down = index.SUN[slot]['altitude'] <= 0
        return {'source': 'sun down' if down else 'offline clear-sky snapshot', 'cloud_cover_pct': None,
                'sun_strength_pct': 0 if down else 100}
    with patch.object(index, 'PASSAGES', catalog), patch.object(index, 'weather_at', side_effect=weather):
        routes = {f'{slot[:2]}:{slot[2:]}': index.route(f'{slot[:2]}:{slot[2:]}') for slot in index.SLOTS}
    for route in routes.values():
        route['offline'] = {'door_dependent_passages_excluded': True}
    return routes


if __name__ == '__main__':
    target = Path(__file__).resolve().parents[1] / 'app' / 'fallback.json'
    target.write_text(json.dumps(bake(), separators=(',', ':')), encoding='utf-8')
    print('Baked 27 offline slots without door-dependent passages')
