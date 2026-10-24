const { test } = require('node:test');
const assert = require('node:assert/strict');

test('short routes interpolate three distinct mobile waypoints', async () => {
  const { routeWaypoints } = await import('../mapUrls.js');
  const points = routeWaypoints([[0, 30], [0.004, 30]]);
  assert.equal(points.length, 3);
  points.forEach(([lon, lat], i) => {
    assert.ok(Math.abs(lon - (i + 1) * 0.001) < 1e-12);
    assert.equal(lat, 30);
  });
});

test('empty, single-point and duplicate-point routes omit invalid waypoints', async () => {
  const { routeWaypoints } = await import('../mapUrls.js');
  for (const c of [[], [[0, 30]], [[0, 30], [0, 30]]]) assert.deepEqual(routeWaypoints(c), []);
  const points = routeWaypoints([[0, 30], [0, 30], [0.004, 30]]);
  assert.ok(points.every(c => c.every(Number.isFinite)));
});

test('map handoffs retain walking mode and endpoint coordinates', async () => {
  const { googleMapsUrl, appleMapsUrl } = await import('../mapUrls.js');
  const start = { lat: 30, lon: -96 }, end = { lat: 31, lon: -97 };
  const google = new URL(googleMapsUrl({ geometry: { coordinates: [[-96, 30], [-97, 31]] } }, start, end));
  assert.equal(google.searchParams.get('origin'), '30,-96');
  assert.equal(google.searchParams.get('travelmode'), 'walking');
  assert.equal(google.searchParams.get('waypoints').split('|').length, 3);
  assert.equal(new URL(appleMapsUrl(start, end)).searchParams.get('dirflg'), 'w');
});
