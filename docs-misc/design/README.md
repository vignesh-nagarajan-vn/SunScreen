# UI redesign prototype

Source for the clickable prototype the current app UI was built from. It was made on a Claude design canvas, not in Figma, so the artboards are HTML files rather than a `.fig`.

| File | Screen |
| --- | --- |
| `redesign/Main.dc.html` | Day: floating trip card, map buttons, sun timeline, side-by-side route cards (interactive) |
| `redesign/Night.dc.html` | Night: streetlight route cards, lamp map, Corps escort card |
| `redesign/Picker.dc.html` | Place picker: search, location actions, category chips, grouped places |
| `redesign/Current.dc.html` | The app before the redesign, for comparison |
| `redesign/canvas.json` | Artboard layout on the canvas |

The artboards use the canvas runtime (`support.js`), so they render on the canvas, not when opened directly. `Current.dc.html` points at an uploaded copy of `../screenshots/1-recommended.png`.

Route numbers and the drawn map in the prototype are sample data; the app uses live routes and real map tiles.
