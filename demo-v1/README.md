<p align="center"><img src="app/assets/logo.svg" width="72" alt="SunScreen logo"></p>

# SunScreen (demo v1)

SunScreen finds a shady walk from The Commons to the Zachry Engineering Education Complex at Texas A&M. For any time of day it shows three routes: the fastest route, a recommended route that adds only a minute or so but has more shade, and the shadiest route that isn't too long. Each route shows how much of the walk is shaded.

| 2 PM, recommended | 2 PM, max shade | 10:30 AM | 7:30 PM, sun down |
|:-:|:-:|:-:|:-:|
| <img src="screenshots/1-afternoon-recommended.png" width="200"> | <img src="screenshots/2-afternoon-max-shade.png" width="200"> | <img src="screenshots/3-morning.png" width="200"> | <img src="screenshots/4-sun-down.png" width="200"> |

These screenshots come from the web build (`make web`), which uses a Leaflet map. In Expo Go the same screen uses the phone's native map.

## How it works

1. `02_lidar` turns USGS LiDAR into 1 m rasters: ground height, surface height (roofs and treetops), and canopy height.
2. `03_shade` uses pvlib to place the sun every 30 minutes from 7:00 to 20:00 and traces shadows from every roof and tree. Anything under cover taller than 2.5 m always counts as shaded.
3. `04_graph` samples those shade masks every 2 m along each OpenStreetMap footpath.
4. The API pulls the Open-Meteo cloud forecast. It measures sunlight strength by comparing the forecast's direct sunlight with clear-sky sunlight (pvlib Ineichen model), so heavy clouds make shade matter less.
5. The API runs Dijkstra with several shade weights and picks three routes:
   - **Fastest:** the shortest path.
   - **Recommended:** the shadiest route within +10% distance, scaled down by sunlight strength.
   - **Max shade:** the shadiest route within +30% distance.

## Setup

You need [Miniforge](https://github.com/conda-forge/miniforge) (for PDAL and GDAL) and Node 20+ (for the app).

```bash
conda create -n shade -c conda-forge python=3.11 pdal python-pdal make --file pipeline/requirements.txt
conda activate shade
```

Run these from `demo/`:

```bash
make data   # ~5 min: geocode, LiDAR download, shadows, graph -> data/
make api    # http://localhost:8000/route?time=14:00
make app    # Expo dev server; scan the QR code with Expo Go
make web    # the same app in a browser
```

Check the API with:

```bash
curl "localhost:8000/route?time=14:00"
```

The response is GeoJSON with three LineStrings: `fastest`, `recommended` and `max_shade`. Each one includes `distance_m`, `time_min` (at 1.4 m/s), `extra_s`, `shaded_pct` and `sun_min`. The response also includes the sun's position and the weather for that slot.

## Phone setup

In Expo Go, the app finds your laptop's IP from the Expo dev server address and calls the API on port 8000 there. The phone and laptop must be on the same Wi-Fi network, and port 8000 must be allowed through the firewall. To use a different address, set `API_OVERRIDE` in [app/config.js](app/config.js).

If the API is unreachable, the app shows the bundled `app/fallback.json` (every time slot, baked with `make fallback`) and labels it as offline.

## Data notes

- **LiDAR source:** the default is the USGS 3DEP `TX_RedRiver_3Area_B2_2018` dataset, about 4 pts/m², flown January 8–10, 2017. It has no vegetation classes, so the CHM is zero. Trees still cast shade through the surface raster, but they were mostly leafless in January, so tree shade is undercounted. TxGIO StratMap point-cloud tiles fix this. Put the `.laz` files in `data/raw/` and `02_lidar` uses them instead.
- **Shadow date:** shadows are cast for the day `03_shade` runs. Run `python pipeline/03_shade.py --date 2026-06-21` to use another date.
- **Weather fallback:** if Open-Meteo is unreachable, the API logs it and assumes a clear sky. The app then shows "weather unavailable".
- **Endpoints:** Nominatim doesn't know "The Commons", so the start point is geocoded as "Commons Dining Hall". Routes start at the nearest footpath, about 40 m from each building; the map shows that gap as a dashed line. To override the endpoints, run `python pipeline/01_area.py --start lat,lon --end lat,lon`.
- **Windows:** keep the conda install path short. Deep package paths can exceed the 260-character limit.
