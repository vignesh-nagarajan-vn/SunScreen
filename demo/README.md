# Shade route demo

Walking from The Commons to the Zachry Engineering Education Complex at Texas A&M, this demo shows the fastest route and the shadiest route for a chosen time of day, with a stat like "+2 min, 35% → 80% shaded".

![screenshot](screenshot.png)
<!-- TODO: add screenshot.png from Expo Go -->

## How it works

1. `01_area` geocodes both endpoints and draws a bbox around them with a 300 m buffer.
2. `02_lidar` pulls the USGS 3DEP LiDAR for that box and builds 1 m ground, surface and canopy-height rasters.
3. `03_shade` uses pvlib to place the sun every 30 minutes from 7:00 to 20:00 and casts shadows from buildings and trees. Anything under cover taller than 2.5 m counts as shaded.
4. `04_graph` samples those shade masks every 2 m along each OpenStreetMap footpath.
5. The API runs Dijkstra with `cost = length × (1 + alpha × (1 − shade))`, and the Expo app draws both routes.

## Setup

You need [Miniforge](https://github.com/conda-forge/miniforge) (for PDAL and GDAL) and Node 20+ (for the app).

```bash
conda create -n shade -c conda-forge python=3.11 pdal python-pdal make --file pipeline/requirements.txt
conda activate shade
```

Run these from `demo/`:

```bash
make data   # ~5-10 min: geocode, LiDAR download, shadows, graph -> data/
make api    # http://localhost:8000/route?time=14:00&alpha=1
make app    # Expo dev server; scan the QR code with Expo Go
```

Check the API with:

```bash
curl "localhost:8000/route?time=14:00&alpha=1"
```

### Options

- **Endpoints:** check the coordinates `01_area` prints. To override them, run `python pipeline/01_area.py --start 30.61,-96.34 --end 30.62,-96.34`.
- **Local LiDAR:** put TxGIO 2025 Brazos `.laz` tiles in `data/raw/` and `02_lidar` uses them instead of the 3DEP EPT.
- **Date:** shadows default to today. Run `python pipeline/03_shade.py --date 2026-06-21` to use another date.
- **Fallback:** after `make data`, run `make fallback` to re-bake `app/fallback.json`.

## Phone setup

The phone can't reach `localhost`, so set `API_BASE` in [app/config.js](app/config.js) to your laptop's LAN IP, for example `http://192.168.1.23:8000`. You can find the IP with `ipconfig` (Windows) or `ipconfig getifaddr en0` (macOS). The phone and laptop must be on the same Wi-Fi network, and port 8000 must be allowed through the firewall.

If the API is unreachable, the app shows the bundled `app/fallback.json` (shade priority 1, every time slot) and labels it as offline.
