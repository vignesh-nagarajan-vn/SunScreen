"""Generate actual API route responses for deterministic browser integration tests."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api import index


if __name__ == '__main__':
    with patch.object(index, 'weather_at', return_value={
            'source': 'test clear sky', 'cloud_cover_pct': 0, 'sun_strength_pct': 100}):
        data = {'default': index.route('14:00'),
                'reverse': index.route('14:00', 'zachry', 'commons'),
                'building': index.route('14:00', 'commons', 'langford'),
                'custom': index.route('14:00', recommended_pct=20, max_detour_pct=50),
                'lighting': index.route(mode='lighting'),
                'lightingCustom': index.route(mode='lighting', recommended_pct=20, max_detour_pct=50)}
    target = Path('tmp/browser-fixtures.json')
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(data), encoding='utf-8')
