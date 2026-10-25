# Building highlights

Pan or zoom the map and tap a campus place label to see its name, category and
building code. Popular places such as Commons, MSC, Langford, Sbisa and libraries
take priority at wider zooms. More classrooms and residences appear as you zoom
in; small campus facilities appear only at close zooms. Labels are spaced apart,
stay inside the visible map and avoid the draggable start/destination pins.
The cap is eight labels at overview zoom, sixteen on phone-sized maps at closer
zooms, and twenty-eight on larger maps. A crowded or very short map can show fewer.

The details card uses the existing route panel: the bottom card on a phone and
the sidebar on desktop. Tapping a place only inspects it. **Start here** or
**Directions** uses that place's canonical destination in the normal route search.
The opposite endpoint is retained. The action that would make both endpoints the
same place is disabled. Close, Back to routes, Escape on the web, or a background
map tap dismisses inspection. Existing named endpoint pins can also be inspected.
Dragging pins or opening the endpoint picker exits inspection; highlights are
hidden while Pick on map is active.

The building catalog is the same bundled [campus destination data](campus-places.md)
used by search. `app/placeHighlights.json` adds short labels, display priorities and
a few verified descriptions; it does not create new route nodes. Texas A&M's
[Langford A page](https://www.arch.tamu.edu/about/facilities/langford-a/) identifies
Azimuth Café inside Langford A. Its café highlight therefore routes to the existing
Langford Architecture destination, rather than claiming a surveyed café entrance.
Texas A&M's [Dining page](https://facilities.tamu.edu/departments/dining.html)
identifies the MSC's dining locations. No live opening hours are claimed.

Labels and details work offline and use the current day/night theme. New trips
retain the existing connection requirements. The three route choices, shade and
lighting calculations, graph and campus bounds are unchanged.

The shared JavaScript checks cover priorities, zoom levels, clipping, label
collisions, endpoint reservations, invalid records and native viewport projection.
Browser checks cover inspecting without routing, canonical endpoint actions,
keyboard selection and dismissal, repeated opening/closing, map picking, and an
offline 320-pixel phone in night mode. The Android bundle is compiled as a separate
check; native touch behavior still needs verification on a physical phone.

Validation: **13 JavaScript tests and 64 Chromium/WebKit browser checks passed**;
web and Android exports both completed. From `app/`, run:

```sh
npm test
npm run export:web
npm run test:web
npx expo export --platform android --output-dir ../tmp/highlight-native-export
```
