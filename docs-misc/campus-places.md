# Campus destinations and shorthand search

The preloaded catalog contains 401 destinations in the existing shaded-routing
area, up from the original 24. It includes 58 residence destinations and the four
dining locations: Commons, Sbisa, Duncan and West Campus. Academic buildings,
libraries, health/student services, athletics and other named campus facilities
are searchable too. This changes destination coverage, not the three route
choices, walking graph, shade masks or lighting scores.

## Using search

Open From or To and type a name, official building code or building number.
Suggestions appear immediately from bundled data. A unique exact match is
selected with Enter; partial matches can be tapped. Ambiguous groups such as
White Creek show multiple buildings and require a choice.

| Type | Destination |
| --- | --- |
| `ILSQ`, `il-sq`, `1500` | Instructional Laboratory & Innovative Learning Building |
| `ILCB`, `I L C B` | Innovative Learning Classroom Building |
| `Beutel`, `BEUT`, `Buetul`, `Buetel` | Beutel Health Center |
| `ASTO`, `Aston`, `Aston Hall` | Aston Residence Hall |
| `HLBL`, `Hullabaloo` | Hullabaloo Residence Hall |
| `Duncan`, `DCAN` | Duncan Dining Hall |
| `SBSA`, `Sbisa` | Sbisa Dining Hall |
| `WCFH`, `West Campus Food Hall` | West Campus Dining Facility |
| `Mays`, `Wehner`, `WCBA` | Mays Business School / Wehner Building |

ILSQ, ILCB and ILSB are separate buildings. Rudder Hall and Rudder Tower are
separate destinations too. Codes and building numbers appear below search
results so similar names remain distinguishable. Names/codes are case
insensitive, and spacing, punctuation and Latin accents are normalized. Common
misspellings are explicit aliases; arbitrary uncertain guesses are not silently
selected. Search results are capped at 40, and the full grouped list is virtualized.

Known campus names and codes never need a geocoder. If nothing matches locally,
Enter or the address-search action uses the existing bounded Nominatim lookup.
Changing or closing a query cancels stale results. Known suggestions remain
available offline; calculating new non-default trips still requires the API.

## Sources and coverage

The source is the official [Aggie Map building directory](https://aggiemap.tamu.edu/directory)
and its public [University Building layer](https://gis.tamu.edu/arcgis/rest/services/FCOR/TAMU_Basemap_20261008/MapServer/2).
The import uses building names, abbreviations, numbers, current/public status and
footprint geometry. It uses a point inside each footprint because many newer
buildings have missing stored latitude/longitude fields. Names/codes come from
the official source; coordinates and interior routes are not guessed from a name.
Additional identity checks include TAMU's [ILSQ description](https://stories.tamu.edu/news/2023/02/03/art-and-science-collide-at-instructional-laboratory-innovative-learning-building/),
[classroom codes](https://www.it.tamu.edu/uavs/classrooms.html),
[dining locations](https://facilities.tamu.edu/departments/dining.html) and
[Residence Life](https://reslife.tamu.edu/).

The bounded snapshot contains 733 footprints. The catalog records why unnamed,
inactive/private/construction or out-of-bounds records were excluded. Existing
destination IDs, coordinates and walkway anchors are preserved. Each addition
is within the current map bounds and no more than 250 m from a node in the
default trip's strongly connected walkway component, so it can connect in either
direction. Raw source snapshots are ignored research artifacts; the source URL,
retrieval time, snapshot hash and audit counts are in
[`data/campus_places.json`](../data/campus_places.json). TAMU source attribution
is preserved; these records are not labeled as OSM data.

This is all eligible named buildings from that source **within current routing
coverage**, not every Google Maps listing or every TAMU satellite campus.
Building points lead to nearby mapped outdoor walkways, not surveyed entrance
doors or rooms. Some nearby buildings share a graph anchor. If both endpoints
share one, the API explains the limitation and suggests adjusting a map pin
rather than inventing a connecting path. Selecting a building does not imply it
is open or that the app supports indoor navigation to a room.

## Refresh and validation

```sh
python scripts/import_campus_places.py --download
# Or replay an archived public ArcGIS snapshot:
python scripts/import_campus_places.py --snapshot tmp/tamu-campus-buildings.json
```

`make places` runs the download/import. It updates `data/campus_places.json` and
`app/places.json` without rebuilding the graph or LiDAR pipeline. The API loads
the catalog locally at startup. Saved node anchors are checked against the graph
and re-snapped if a graph rebuild changes them. Invalid records are isolated;
a missing/broken catalog falls back to the original graph places. Vercel bundles
the catalog alongside the graph.

`/api/places` returns the same public names/codes/aliases as the picker.
`/api/search?q=ILCB` resolves locally. `/api/route?from=ILSQ&to=ILCB` accepts unique
exact names/codes as well as canonical IDs; ambiguous aliases are never silently
resolved to the first match. Room numbers are outside this feature's scope.

Tests share alias/ranking fixtures between Python and JavaScript, check every
catalog point against bounds/connectivity, preserve original anchors, exercise
both route modes and verify fallback/stale-data behavior. Browser checks cover
code/typo selection without geocoding, distinct ILSQ/ILCB endpoints, dorm/dining
search on a 320 px phone, ambiguous groups and cancelled address results.
The route audit retains the original 24-place all-pairs matrix at all 27 slots
and additionally checks every new destination to/from Commons at 14:00. It does
not claim an exhaustive 401-place all-pairs matrix.

Validation passed 81 backend tests, 8 JavaScript tests, 52 browser checks and
15,658 route-audit cases. The ten campus-search browser checks were rerun on the
final catalog. See [the validation record](campus-place-validation.json). Native
hardware and physical entrance verification were not performed.
