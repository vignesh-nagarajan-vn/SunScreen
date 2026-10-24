# Route distance preferences

The gear next to Night mode opens a small panel. Recommended defaults to +10%
distance; Max shade (or Most lit at night) defaults to +30%. A 30% allowance can
consider routes up to 1.30 km when Fastest is 1 km. It does not request 30%
shade or lighting, and it does not force a detour.

Both controls use 5 percentage-point steps from 0% through 100%. The maximum
route must allow at least as much extra distance as Recommended. The API also
accepts finite fractional percentages. At 100%, the distance can double. Fastest
is unaffected, and the app continues to return exactly three choices.

The panel explains that longer distance may not reduce total sun exposure or
improve lighting. It warns about long detours, unconfirmed building access and
estimated lighting. It does not offer a safety guarantee. Daytime Recommended
continues to reduce its allowance in weak sunlight; nighttime limits are not
weather dependent. Existing building-access checks and lighting evidence rules
remain in effect. The search picks from its evaluated Dijkstra candidates, so
raising a cap does not guarantee a different route.

Edits remain a draft until Apply. Cancel, Escape on web, Android Back or tapping
the backdrop dismisses the panel without saving. Reset changes the draft back
to 10% / 30%; Apply saves it. The panel uses the current theme and supports touch,
keyboard arrows, Home/End and announced slider percentages.

Preferences persist in browser local storage under `sunscreen-route-limits`.
Native retains them for the session, matching the existing convenience storage.
Malformed saved values reset to defaults. No account or shared server preference
is created. Each request carries its own limits and verifies the API echo so an
older server cannot silently ignore a custom setting. Stale requests cannot
overwrite newer trips/settings.

Custom limits require an online API. Cached default routes are never presented
as satisfying custom limits. A connection/unsupported-server message offers the
reset path; applying defaults restores normal offline fallback for the default
trip. There are no new route choices or indoor controls.

## Test it

1. Open the app and tap the gear beside Night mode.
2. Set Recommended to 20% and Max shade to 50%; read the distance example and
   long-detour warning, then Apply. Compare the usual three route cards.
3. Reopen settings or reload the browser to check the saved values.
4. Edit a value and Cancel; verify the saved value is unchanged.
5. Set Recommended above Max shade; Apply must be disabled with an explanation.
6. Enable Night mode; the second control becomes Most lit and the lighting
   warnings appear. Apply still updates the same three route choices.
7. Go offline with custom settings. The app must show a useful error rather
   than default cached routes. Reset and Apply to restore default-trip fallback.

Automated backend tests cover default compatibility, both routing modes, caps
at 0%/100%, weak sunlight, unchanged Fastest, bad/inverted API values and
synthetic paths where changing a limit changes the selected route. Browser
tests cover the panel on small phones, keyboard/touch input, persistence,
Cancel/Escape/Reset, validation, offline behavior and servers ignoring settings.
Pure JavaScript tests cover corrupt saved preferences and response matching.

Local verification passed 69 backend tests, 6 JavaScript tests and 32 browser
checks across Chromium and WebKit. Light and dark screenshots were inspected.
Native hardware was not tested.

```sh
python -m unittest discover -s tests -p "test_*.py"
python tests/make_browser_fixtures.py
cd app
npm test
npm run export:web
npm run test:web
```
