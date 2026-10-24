PY ?= python

.PHONY: data refresh test test-routes test-browser audit-routes api app web bake deploy

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

test-routes:
	$(PY) -m unittest discover -s tests -p "test_*.py"

audit-routes:
	$(PY) scripts/audit_routes.py --all-slots

test-browser:
	$(PY) tests/make_browser_fixtures.py
	cd app && npm run export:web && npm run test:web

api:
	cd api && $(PY) -m uvicorn index:app --host 0.0.0.0 --port 8000

app:
	cd app && npm install && npx expo start

web:
	cd app && npm install && npx expo start --web

# Bundle the places list and offline routes (default trip, every time slot) into the app.
bake:
	cd api && $(PY) -c "import json, index; json.dump(index.places(), open('../app/places.json', 'w'), indent=1)"
	$(PY) scripts/bake_routes.py

# Web app + API deploy from the repo root (vercel.json): pushes to main redeploy automatically.
# Manual deploy: link once with npx vercel link, then run this.
deploy:
	npx vercel deploy --prod --yes
