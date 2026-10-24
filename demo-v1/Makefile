PY ?= python

.PHONY: data test api app web fallback

data: test
	$(PY) pipeline/01_area.py
	$(PY) pipeline/02_lidar.py
	$(PY) pipeline/03_shade.py
	$(PY) pipeline/04_graph.py

test:
	$(PY) pipeline/test_shade.py

api:
	cd api && $(PY) -m uvicorn main:app --host 0.0.0.0 --port 8000

app:
	cd app && npm install && npx expo start

web:
	cd app && npm install && npx expo start --web

# Re-bake app/fallback.json (every time slot) from the current graph and weather.
fallback:
	cd api && $(PY) -c "import json, main; json.dump({r['time']: r for r in (main.route(s[:2] + ':' + s[2:]) for s in main.SLOTS)}, open('../app/fallback.json', 'w', encoding='utf-8'), ensure_ascii=False)"
