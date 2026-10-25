# Building passages in campus routes

Mapped building passages participate automatically in the existing Fastest,
Recommended and Max shade choices. There is no fourth route or building toggle.
The map and route cards remain the normal phone navigation interface. Documented
room destinations use a compact [indoor guide](indoor-routing.md).

## Search and access

The overlay joins documented entrance-to-exit sections to existing outdoor door
nodes. Indoor and covered sections count as fully shaded; their walking distance
still contributes to route cost. No estimated air-conditioning bonus is added.
Outdoor candidates remain available, including when building data is broken or
closed. A building can also connect otherwise disconnected outdoor components.

Recommended retains the existing +10% distance allowance, scaled by sunlight;
Max shade retains +30%. The search evaluates several Dijkstra shade weights on
both networks, adding bounded, loop-free passage candidates when necessary.
It chooses the best evaluated candidate within each limit;
this is not a proof of the global optimum under a distance constraint. A
building passage is selected when it improves a normal choice, not forced into
every trip. Commons to Zachry can still favor an outdoor alternative.

Weekly schedules, overnight windows, dated closures, expiry and one-way passages
are supported. Availability is checked at departure and over the estimated
arrival/traversal interval. Restricted or expired records are excluded. Unknown
hours are excluded unless a record explicitly uses `allow_with_notice`.
Langford uses that provisional policy; MSC uses published hours with unconfirmed
door access. Selected provisional passages display **Check building access**. Their doors are not asserted
to be open. There is no live door-status service.

Covered fractions are clipped to their actual portion of an existing edge,
matched by edge key and geometry hash. Crossing/nearby paths and other parallel
edges do not inherit cover. Existing LiDAR roof shade is not double counted.
Invalid records are diagnosed independently, and request overlays leave the
saved graph unchanged. Rebuilding the graph requires reimporting matched roofs.

Offline default-trip routes retain unconditional public outdoor cover but
exclude enclosed, door-dependent passages and scheduled/dated restrictions.
They are marked offline and use baked weather assumptions.

## Coverage

The October 24, 2026 public OSM snapshot contains 1,584 building footprints,
including roof structures, of which 354 have names. It contains **zero explicitly
mapped indoor pedestrian ways**. The importer matched 22 covered-walkway/roof
records to the saved campus pedestrian graph. The hand-authored provisional
Langford A corridor remains in the catalog alongside them. A provisional MSC
first-floor route and its limits are documented in [indoor routing](indoor-routing.md).

This implements building-aware routing throughout the app, with the available
documented data. It does not provide every building's interior. Footprints alone
cannot establish doors, corridors, public access or floor transitions.
See [data review](building-data-review.md), the source links in
[the catalog](../data/building_passages.json), and the machine-readable
[coverage audit](../data/building_coverage.json).

To refresh outdoor cover after changing the graph:

```sh
python scripts/import_building_paths.py --download
# Or use an archived OSM XML extract:
python scripts/import_building_paths.py --osm path/to/campus.osm
python scripts/bake_routes.py
```

The importer excludes roads/driveways, private/conditional access and mapped
emergency/exit-only/locked passages. It preserves manually maintained records.
Maintain each enclosed corridor with two graph-connected doors, continuous
sections, public-access evidence and a schedule or explicit unknown-hours
policy. `/api/building-passages` exposes the catalog for maintenance.

## Validation

Recorded results: **41 backend tests, 3 map-handoff tests, 20 browser tests and
14,904 campus trips passed**. See the [validation report](building-validation.json)
for dataset hashes, coverage and limitations.

Python 3.12 and Node 22 were used. From the repository root:

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -p "test_*.py"
python scripts/audit_routes.py --all-slots
python tests/make_browser_fixtures.py
cd app
npm ci
npm run test:urls
npx playwright install chromium webkit
npm run export:web
npm run test:web
```

The audit checks all 552 ordered pairs of the 24 places at all 27 time slots:
14,904 trips. It validates three route IDs, exact shared endpoints, finite
geometry, metrics, segment ranges and distance limits. It uses fixed clear-sky
weather, not live network conditions. The backend suite also tests closure at
arrival, overnight/DST hours, bad data, parallel/partial roofs, disconnected
graphs, malformed weather and concurrent request isolation.

Browser checks run in Chromium and WebKit at phone and desktop sizes, including
320 x 568. They cover normal building selection, three options, cached fallback,
failed and late requests, repeated map updates, literal address text and campus
time on a device using another timezone. Tile requests are deliberately blocked
in tests to verify route rendering during a tile outage. Native Expo Go and
physical walking/door verification remain separate checks.

Google Maps receives three intermediate waypoints, but may recalculate and omit
a building. Apple Maps receives endpoints only. The handoff note makes this
limit visible when the selected route uses a building/covered section.
