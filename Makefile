PY ?= python

.PHONY: data refresh test api app web bake deploy

data: test
	$(PY) pipeline/01_area.py
	$(PY) pipeline/02_lidar.py
	$(PY) pipeline/03_shade.py
	$(PY) pipeline/04_graph.py

# Re-cast shadows for today's sun (reuses the LiDAR rasters) and rebuild the graph.
refresh: test
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

# Bundle the places list and offline routes (default trip, every time slot) into the app.
bake:
	cd api && $(PY) -c "import json, main; json.dump(main.places(), open('../app/places.json', 'w'), indent=1)"
	cd api && $(PY) -c "import json, main; json.dump({r['time']: r for r in (main.route(s[:2] + ':' + s[2:]) for s in main.SLOTS)}, open('../app/fallback.json', 'w', encoding='utf-8'), ensure_ascii=False)"

# Web app + API as one Vercel project in deploy/ (static files + a Python function at /api/*).
# The first time, link it: cd deploy && npx vercel link --project sunscreen
deploy:
	cd app && npx expo export --platform web --output-dir ../web-dist
	rm -rf deploy/_expo deploy/assets deploy/api deploy/data
	mkdir -p deploy/api deploy/data
	cp -r web-dist/. deploy/
	cp api/main.py deploy/api/index.py
	cp api/vercel.json api/requirements.txt deploy/
	cp data/graph.pkl deploy/data/
	cd deploy && npx vercel deploy --prod --yes
