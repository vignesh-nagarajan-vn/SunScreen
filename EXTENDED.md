<p align="center"><img src="app/assets/logo.svg" width="72" alt="SunScreen logo"></p>

# SunScreen: extended docs

SunScreen finds shady walking routes anywhere on Texas A&M's main campus and the nearby neighborhoods (Northgate, Southside and West Campus). Pick a start and destination from 24 campus places, search for an address, drop a pin, or use your location. For any time from 7 AM to 8 PM it shows three routes: the fastest route, a recommended route that adds only a minute or so but has more shade, and the shadiest route that isn't too long.

**Live demo:** [sunscreen-psi.vercel.app](https://sunscreen-psi.vercel.app). It's the web app plus the routing API, deployed together on Vercel with `make deploy`.

## How it works

1. `01_area` geocodes 24 campus places and sets the routing area to their extent plus 400 m. The map can't pan or zoom out past that area.
2. `02_lidar` downloads the TxGIO StratMap 2025 LiDAR tiles for the area (falling back to USGS 3DEP) and builds 1 m ground (DTM), surface (DSM) and canopy-height (CHM) rasters.
3. `03_shade` uses pvlib to place the sun every 30 minutes from 7:00 to 20:00 and traces shadows from every roof and tree. Anything under cover taller than 2.5 m always counts as shaded.
4. `04_graph` samples those shade masks every 2 m along each OpenStreetMap footpath.
5. The API pulls today's Open-Meteo forecast. It measures sunlight strength by comparing the forecast's direct sunlight with clear-sky sunlight (pvlib Ineichen model), so heavy clouds make shade matter less.
6. The API runs Dijkstra with several shade weights and picks three routes:
   - **Fastest:** the shortest path.
   - **Recommended:** the shadiest route within +10% distance, scaled down by sunlight strength.
   - **Max shade:** the shadiest route within +30% distance.
7. **Open in Google Maps** hands the selected route to Google Maps for turn-by-turn walking directions. It passes three waypoints along the route, which is Google's limit on phones, so Google follows the shady path. **Apple Maps** URLs can't carry waypoints, so Apple gets the same start and destination and picks its own path.

## Using the app

- **From / To:** opens a picker with campus places grouped by type, your recent picks, distances once you've shared your location, address search, **My location** and **Pick on map**. The ⇅ button swaps the two.
- **Map:** the selected route is colored segment by segment from shade (maroon) to sun (gold). The fastest route is dashed gray, and the third route is drawn thinner.
- **Time:** drag the slider, tap **Now**, or tap **Play day** to step through the day while the routes redraw.
- **Routes card:** on phones it shows the selected route; tap or swipe the handle to compare all three. Pick a route, then hand it off with **Open in Google Maps** or **Apple Maps**.
- **ⓘ:** a short "How SunScreen works" explainer. It opens on the first visit to the website; add `?intro=0` to the URL to skip it.
- **Wide screens** (900 px and up) put the controls in a side panel next to a full-height map.

## Setup

For the checked-in routing data, use Python 3.12 and Node 22. You do not need to
rerun the LiDAR pipeline to try this feature. From the repository root, start
the API in one terminal:

```sh
python -m pip install -r requirements-dev.txt uvicorn
python -m uvicorn api.index:app --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
cd app
npm ci
npx expo start --web
```

Open the local URL printed by Expo. Local web uses the API on port 8000.
The feature is in the normal route choices, so choose endpoints and a time as
usual. Building coverage, validation commands and limitations are documented in
[building passages](docs/building-shortcuts.md). A remote feature branch is not
automatically the production Vercel site; use its Vercel preview if configured.

Rebuilding the LiDAR data additionally needs
[Miniforge](https://github.com/conda-forge/miniforge) for PDAL and GDAL:

```bash
conda create -n shade -c conda-forge python=3.12 pdal python-pdal make --file pipeline/requirements.txt
conda activate shade
```

Run these from the repo root:

```bash
make data     # ~45 min the first time: geocode, ~700 MB LiDAR download, shadows, graph -> data/
make refresh  # re-cast shadows for today's sun and rebuild the graph (reuses the LiDAR)
make bake     # bundle app/places.json and the offline routes in app/fallback.json
make api      # http://localhost:8000/api/route?time=14:00&from=commons&to=zachry
make web      # the app in a browser, using the local API
make app      # Expo dev server; scan the QR code with Expo Go
make deploy   # web app + API to Vercel (pushes to main also redeploy; link once: npx vercel link)
```

Check the API with:

```bash
curl "localhost:8000/api/route?time=14:00&from=msc&to=zachry"
```

## API

### Building passages in the normal search

Every normal `/api/route` request automatically considers mapped building
passages and covered outdoor paths. It returns exactly three options: Fastest,
Recommended, and Max shade. No indoor setting, separate route, floor picker or
room destination is required. The existing distance limits still apply.

The catalog includes a provisional Langford A corridor and 22 matched
covered-walkway/roof records across campus. Current Langford door access, exact
geometry and opening hours are unverified; a compact access notice appears if
it is selected. Scheduled closures are checked through estimated traversal.
Offline routes exclude enclosed door-dependent passages. More interiors require
documented entrance-to-exit paths before being added.
See [building passages](docs/building-shortcuts.md) for sources and tests.

### Existing endpoints

Every endpoint is served at both `/x` and `/api/x`.

- **`/route`:** takes `time=HH:MM` (snapped to the nearest 30-minute slot), plus `from` and `to`. Each endpoint can be a place id from `/places` or `lat,lon`, and `from_name` and `to_name` label custom points. The response is GeoJSON with three LineStrings: `fastest`, `recommended` and `max_shade`. Each one includes `distance_m`, `time_min` (at 1.4 m/s), `extra_s`, `shaded_pct`, `sun_min`, and `runs`: one `[first coord, last coord, shade]` entry per path segment, which the app uses to color the route from shade (maroon) to sun (gold). The response also includes the sun's position and the weather for that slot.
- **`/places`:** the campus places and the bounds of the routing area.
- **`/search?q=`:** a Nominatim search limited to the routing area.

Points outside the area, or more than 250 m from any walkway, get a 400 response with a plain-English reason that the app shows.

## Phone setup

Expo Go uses the hosted API by default, so the phone doesn't need your laptop. To use your own API, set `API_OVERRIDE` in [app/config.js](app/config.js) to your laptop's LAN IP, for example `http://192.168.1.23:8000`. The phone and laptop must be on the same Wi-Fi network, and port 8000 must be allowed through the firewall.

If the API is unreachable, the app falls back to the bundled routes for The Commons → Zachry and labels them as offline.

## Data notes

- **LiDAR source:** TxGIO StratMap 2025 (Little/Middle/Lower Brazos basins), flown January–March 2025 and classified with vegetation (classes 3–5) and buildings. It was flown in winter, so deciduous trees are bare and their shade is undercounted; live oaks keep their leaves. If TxGIO is unreachable, `02_lidar` says so and uses the USGS 3DEP `TX_RedRiver_3Area_B2_2018` EPT, which has no vegetation classes. `.laz` files already in `data/raw/` are always used first.
- **Trees:** canopy is treated as fully opaque.
- **Shadow date:** shadows are cast for the day `03_shade` runs, while weather is always today's. The sun's noon height changes by about 5° every two weeks in autumn, so run `make refresh` before a demo. To use another date, run `python pipeline/03_shade.py --date 2026-06-21`.
- **Weather fallback:** if Open-Meteo is unreachable, the API logs it and assumes a clear sky, and the app shows "weather unavailable".
- **Places:** Nominatim doesn't know "The Commons", so it's geocoded as "Commons Dining Hall". `01_area` drops any geocode that lands outside the campus box (some names match buildings in other states). To override a place, run `python pipeline/01_area.py --place id=lat,lon`. Routes start at the nearest footpath node, and the map shows that gap as a dashed line.
- **Windows:** keep the conda install path short. Deep package paths can exceed the 260-character limit.
