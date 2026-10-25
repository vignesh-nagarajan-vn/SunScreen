"""Generate actual API route responses for deterministic browser integration tests."""
import json
import sys
from pathlib import Path
from unittest.mock import patch
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api import index


if __name__ == '__main__':
    with patch.object(index, 'weather_at', return_value={
            'source': 'test clear sky', 'cloud_cover_pct': 0, 'sun_strength_pct': 100}), \
         patch.object(index, 'datetime', wraps=datetime) as clock:
        clock.now.return_value = datetime.fromisoformat('2026-10-26T14:00:00-05:00')
        data = {'default': index.route('14:00'),
                'reverse': index.route('14:00', 'zachry', 'commons'),
                'building': index.route('14:00', 'commons', 'langford'),
                'custom': index.route('14:00', recommended_pct=20, max_detour_pct=50),
                'lighting': index.route(mode='lighting'),
                'lightingCustom': index.route(mode='lighting', recommended_pct=20, max_detour_pct=50),
                'ilsqToIlcb': index.route('14:00', 'ilsq', 'ilcb'),
                'room': index.route('14:00', 'commons', 'zachry_596'),
                'roomReverse': index.route('14:00', 'zachry_596', 'commons'),
                'roomLighting': index.route(mode='lighting', src='commons', dst='zachry_596'),
                'mscShortcut': index.route('14:00', 'ilsq', 'commons')}
        data['placeTrips'] = {pid: index.route('14:00', pid, 'zachry') for pid in
                              ('ilsq', 'ilcb', 'beutel', 'hullabaloo', 'duncan', 'building_0447')}
    target = Path('tmp/browser-fixtures.json')
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(data), encoding='utf-8')
