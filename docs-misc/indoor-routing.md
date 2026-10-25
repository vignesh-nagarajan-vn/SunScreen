# Room guidance and building passages

Search **Zach 596**, **ZACH596**, **Zachry room 596** or **596 ZACH** in From or To.
The compact **Indoor directions** card shows level-1 entry, elevators and the
level-5 learning-studio wing, with a link to the official plan. Reverse trips
show exit directions. The guide remains available offline or when a room trip
cannot be routed. Unsupported room numbers are reported as unmapped and never
silently become address searches or guesses at another room.

**Walking distances and ETAs cover the outdoor trip to/from the entrance.** The
room guide is schematic, not indoor GPS, measured floor geometry or an elevator
wait estimate. Room access and elevator operation are unconfirmed. Same-building
requests explain that no outdoor trip is needed; the indoor guide remains available.
Normal building destinations keep their building map pins.
Room selections now use their containing building's map pin; the room number and
floor stay in the expandable indoor guide. The outdoor line still reaches the
reviewed entrance approach rather than pretending to locate room 596 outdoors.

## Entrances and room evidence

`data/building_entrances.json` inventories **64 explicitly tagged entrances** on
**210 matched buildings**. It retains emergency/exit-only status, restrictions,
graph connectivity, `level` and `level:ref`. This is source evidence, not a claim
that all buildings have mapped doors or are open. `/api/building-entrances`
exposes it for maintenance.

Zachry has eight connected entrance nodes: four emergency exits and three raised
entries leave one mapped level-1 approach. Room 596 uses OSM node
[6193744746](https://www.openstreetmap.org/node/6193744746), explicitly tagged
`level=0`, `level:ref=1`, with an exact saved-graph connection. Stale, disconnected,
emergency and wrong-level room anchors are disabled instead of re-snapped.

The official [Zachry facility map](https://zachry.tamu.edu/wp-content/uploads/2018/08/ZACH-Tour-Book-web-accessible.pdf)
shows level-1 circulation/elevators on PDF page 7 and room 596 beside 598 on
level 5, page 11. This older plan is still linked from the
[official location page](https://zachry.tamu.edu/location/), which supplies building
hours. Departure and estimated outdoor arrival are checked against that schedule;
holidays, room-specific locks and lift outages are not a live service.

`data/indoor_destinations.json` is the room source. `python -m campus_routing.indoors`
exports `app/indoorPlaces.json`; API and offline picker metadata must match.
Vercel bundles the room and entrance catalogs alongside the graph.

## MSC in the normal shade choices

MSC is OSM [relation 2083295](https://www.openstreetmap.org/relation/2083295), with
**no explicitly entrance-tagged boundary nodes in this snapshot**. The provisional
MSC route matches mapped pedestrian approaches to published first-floor circulation:
Leadership entrance, Retail Hall, the corridor beside Respect entrance/bookstore,
the cross hall south of the Flag Room, 12th Man Hall and Integrity entrance.
Its short unmapped west approach is conservatively **unshaded outdoor distance**.
Indoor sections are checked against the retained footprint and courtyard.
The additional **Honor entrance → Hall of Honor → shared corridor west of the
Flag Room → Integrity entrance** candidate uses the northwest side of MSC,
avoiding the longer approach to Leadership. The Honor entry and circulation are
shown on the current official detail. Both traces remain provisional.

ILSQ now uses its north entrance approach by Old Main Drive (saved walkway node
11693047228), supported by [TAMU's entrance photographs](https://today.tamu.edu/news/2023/02/03/art-and-science-collide-at-instructional-laboratory-innovative-learning-building/).
It replaces the southeast anchor that made Commons trips wrap around ILSQ.
Reviewed approach metadata survives catalog refreshes and is rejected if its
saved graph coordinates change.

Sources are the organizer-published [2015 TAMU conference plan, PDF page 29](https://students.ans.org/wp-content/uploads/2016/12/2015TAMU.pdf),
the current official [first-floor event-space detail](https://ucenter.tamu.edu/wp-content/uploads/2024/12/MSC_FirstFloor_FloorPlan.jpg),
and [MSC building hours](https://ucenter.tamu.edu/facilities/memorial-student-center/).
The whole-building trace and doorway positions are schematic and need a field
check, including current construction/access. Selected provisional passages show
**Check building access**. The footprint check does not verify every internal wall.
Enclosed passages remain excluded from offline saved routes and streetlight routing.

The search adds bounded, loop-free passage candidates when its regular weighted
paths have not already found a feasible traversal. It checks traversal hours and
keeps the user's distance limits and exactly three choices. It does not force MSC
onto a trip or claim a global constrained shortest-path optimum.

For **ILSQ → Commons**, clear sky at 2 PM on Monday, October 26, 2026:

| Choice | Walk | Distance | Shade | MSC |
| --- | ---: | ---: | ---: | --- |
| Fastest | 14.7 min | 1,235 m | 41% | No |
| Recommended | 15.0 min | 1,256 m | 59% | No |
| Max shade | 18.2 min | 1,526 m | 70% | Yes, Honor entrance |

MSC fits the default 30% allowance, but exceeds Recommended's 10% allowance.
Indoor distance contributes to walking cost and shade; no assumed HVAC bonus is
added. Results depend on time, weather, access schedule, graph and route settings.
The reverse Commons → ILSQ example selects an outdoor Max shade route
(1,548 m, 73% shaded) over MSC. Passages are considered, never forced.
The corrected ILSQ approach saves about 150 m on Fastest; the northwest MSC
candidate is about 260 m shorter than the earlier 1,786 m MSC example.

## Refresh and verification

```sh
python scripts/import_building_entrances.py --osm tmp/campus-entrances-osm.xml
python -m campus_routing.indoors
python -m unittest discover -s tests -p 'test_*.py'
python scripts/audit_routes.py --all-slots
python tests/make_browser_fixtures.py
cd app
npm test
npm run export:web
npm run test:web
```

The snapshot comes from the public OSM map API using existing campus coverage
bounds. Door inventories never generate corridors. Maintain passages and room
guides with plan evidence and recheck anchors after graph rebuilds. OSM-derived
records retain OpenStreetMap contributor credit and ODbL-1.0 attribution.

See [validation and source hashes](indoor-validation.json). That report
predates the building-pin and northwest-entrance corrections;
the follow-up received 27 focused local backend checks and a browser pin check,
without rerunning the full audit or Actions workflow.
Browser coverage includes aliases, forward/reverse guidance, unsupported rooms, MSC in the normal
choices, expansion accessibility and first-step visibility on a 320-pixel phone.
The native bundle compiles; physical-phone and corridor/door checks remain outstanding.
