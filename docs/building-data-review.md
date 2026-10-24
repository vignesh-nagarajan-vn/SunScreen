# Building data review: October 24, 2026

The feature needs public entrance-to-exit paths, not room destinations. Research
was used to add supported cover and identify where evidence is still missing.
The raw OSM extract is a local research artifact; its SHA-256 and counts are in
`data/building_coverage.json`. Each imported catalog record links its OSM source
and credits OpenStreetMap contributors under ODbL 1.0.

| Source | Evidence and routing decision |
| --- | --- |
| [Official Langford A facilities page](https://www.arch.tamu.edu/about/facilities/langford-a/) | Identifies the atrium/cafe building. It does not establish current public door hours. |
| [TAMU thesis, Figure 24](https://oaktrust.library.tamu.edu/bitstreams/df2776aa-5b73-4543-a4fd-4b652daecc60/download#page=142) | First-floor schematic, printed page 120 / PDF page 142. Supports a provisional corridor layout, not surveyed turn-by-turn geometry. |
| [Langford A OSM footprint](https://www.openstreetmap.org/way/155052696) | Doors 11693047117 and 11693047110 already connect to the saved outdoor graph. They anchor the provisional corridor. |
| [Raised B/C connector](https://www.openstreetmap.org/way/307097865) and [mapped footway](https://www.openstreetmap.org/way/411547655) | Supports outdoor roof cover. No air conditioning is inferred. |
| [Official Zachry location/hours](https://zachry.tamu.edu/location/) and [official workshop directions](https://nsspi.tamu.edu/workshop-logistics/) | Hours alone do not establish an interior path. Directions describe different entrance levels and stairs/elevator access from the south. |
| [Zachry OSM footprint](https://www.openstreetmap.org/way/451759287) | Mapped normal doors have levels 0, 0.5, 1 and 1.5; several others are emergency exits. A straight same-floor shortcut would invent missing transitions, so none was added. |
| [TAMU Library spaces](https://library.tamu.edu/spaces/index.html) | A floor explorer is available, but no entrance-to-exit graph with verified exterior connections was established for this release. No inferred library shortcut was added. |

The user's familiar path between Langford B/C and past the cafe is useful
context, but it has not been matched door by door to the provisional A corridor.
That remains the main Langford field-validation task. Public hours, precise
geometry and any stairs or accessibility constraints need confirmation before
calling it verified navigation.

The importer audited all footprints in the campus snapshot. It accepts explicit
covered pedestrian paths and intersections of existing pedestrian geometry with
roof/raised-building polygons. It does not cut new routes across ordinary
building footprints. Unmatched source paths and rejected road/driveway records
are recorded in the coverage audit. The 22 roof records are data coverage, not a
claim that 22 interiors or all 1,584 footprints are navigable.
