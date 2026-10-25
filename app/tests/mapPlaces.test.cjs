const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../places.json').places;
const highlights = require('../placeHighlights.json');
const place = (id, category = 'Academic') => ({ id, name: id, category, lat: 30.61, lon: -96.34 });
const view = { zoom: 17, width: 600, height: 600, project: p => ({ x: p.x, y: p.y }) };

test('every curated highlight uses an existing canonical building and preserves its routing coordinates', async () => {
  const { mapPlaces } = await import('../mapPlaces.js');
  const mapped = mapPlaces(catalog, highlights);
  assert.equal(mapped.length, catalog.length);
  for (const id of Object.keys(highlights)) {
    const original = catalog.find(p => p.id === id), decorated = mapped.find(p => p.id === id);
    assert.ok(original, id);
    for (const key of ['id', 'name', 'lat', 'lon', 'category']) assert.equal(decorated[key], original[key]);
    assert.equal(original.priority, undefined);
  }
  assert.equal(mapped.find(p => p.id === 'langford').kind, 'cafe');
  assert.match(mapped.find(p => p.id === 'langford').detail, /inside Langford A/);
  assert.match(highlights.langford.source, /^https:\/\/www.arch.tamu.edu\//);
});

test('overview favors popular places and zoom reveals ordinary buildings then small facilities', async () => {
  const { mapPlaces, visibleMapPlaces } = await import('../mapPlaces.js');
  const places = mapPlaces([place('msc', 'Student life'), place('classroom'), place('shed', 'Campus facilities')], highlights)
    .map((p, i) => ({ ...p, x: 40 + i * 180, y: 90 }));
  assert.deepEqual(visibleMapPlaces(places, { ...view, zoom: 15 }).map(p => p.id), ['msc']);
  assert.deepEqual(visibleMapPlaces(places, view).map(p => p.id), ['msc', 'classroom']);
  assert.deepEqual(visibleMapPlaces(places, { ...view, zoom: 18 }).map(p => p.id), ['msc', 'classroom', 'shed']);
});

test('nearby labels prefer the important place and never cover reserved endpoint space', async () => {
  const { mapPlaces, visibleMapPlaces } = await import('../mapPlaces.js');
  const places = mapPlaces([place('less-important'), place('msc', 'Student life'), place('third')], highlights)
    .map((p, i) => ({ ...p, x: i < 2 ? 90 : 310, y: 90 }));
  assert.deepEqual(visibleMapPlaces(places, view).map(p => p.id), ['msc', 'third']);
  const reserved = [{ left: 50, right: 240, top: 40, bottom: 130 }];
  assert.deepEqual(visibleMapPlaces(places, { ...view, reserved }).map(p => p.id), ['third']);
  assert.deepEqual(visibleMapPlaces(places, { ...view, excludedIds: ['msc'] }).map(p => p.id), ['less-important', 'third']);
});

test('phone labels are capped and clipped or invalid points cannot become invisible tap targets', async () => {
  const { mapPlaces, visibleMapPlaces } = await import('../mapPlaces.js');
  const places = mapPlaces(Array.from({ length: 80 }, (_, i) => place(`p${i}`)))
    .map((p, i) => ({ ...p, x: 30 + (i % 3) * 170, y: 30 + Math.floor(i / 3) * 60 }));
  assert.equal(visibleMapPlaces(places, { ...view, width: 590, height: 3000 }).length, 16);
  assert.equal(visibleMapPlaces(places, { ...view, height: 3000 }).length, 28);
  assert.deepEqual(visibleMapPlaces(places, { ...view, width: 0 }), []);
  assert.deepEqual(visibleMapPlaces(places, { ...view, project: () => ({ x: NaN, y: 50 }) }), []);
  assert.deepEqual(visibleMapPlaces(places, { ...view, project: () => ({ x: 599, y: 50 }) }), []);
  assert.equal(mapPlaces([null, place('same'), place('same'), { ...place('bad'), lat: NaN }]).length, 1);
});

test('selected buildings retain a highlight at overview zoom and native projection follows the viewport', async () => {
  const { mapPlaces, visibleMapPlaces, projectRegion } = await import('../mapPlaces.js');
  const places = mapPlaces([place('classroom')]).map(p => ({ ...p, x: 80, y: 80 }));
  assert.equal(visibleMapPlaces(places, { ...view, zoom: 14, selectedId: 'classroom' }).length, 1);
  const region = { latitude: 30.61, longitude: -96.34, latitudeDelta: 0.02, longitudeDelta: 0.02 };
  const middle = projectRegion(place('center'), region, { width: 400, height: 600 });
  assert.ok(Math.abs(middle.x - 200) < 0.001);
  assert.ok(Math.abs(middle.y - 300) < 0.1);
  const northWest = projectRegion({ lat: 30.62, lon: -96.35 }, region, { width: 400, height: 600 });
  assert.ok(Math.abs(northWest.x) < 0.001 && Math.abs(northWest.y) < 0.001);
});
