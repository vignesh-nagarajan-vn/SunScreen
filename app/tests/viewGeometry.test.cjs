const { test } = require('node:test');
const assert = require('node:assert/strict');

test('dragging the sheet keeps its height bounded and leaves space for the map', async () => {
  const { sheetLimits, clampSheetHeight } = await import('../viewGeometry.js');
  for (const height of [360, 600, 844, 1000]) {
    const limits = sheetLimits(height, 36, 110, height < 700);
    assert.ok(limits.min <= limits.initial && limits.initial <= limits.max);
    assert.ok(limits.max < height - 110);
    assert.equal(clampSheetHeight(-1000, limits), limits.min);
    assert.equal(clampSheetHeight(10000, limits), limits.max);
  }
  const tall = sheetLimits(844, 36, 110, false);
  assert.equal(clampSheetHeight(tall.initial + 100, tall), tall.initial + 100);
  assert.equal(clampSheetHeight(tall.initial - 100, tall), tall.initial - 100);
});

test('route fitting waits for the map and layout without losing the first fit', async () => {
  const { routeFitKey } = await import('../viewGeometry.js');
  const route = { start: { lat: 30.61, lon: -96.34 }, end: { lat: 30.62, lon: -96.33 } };
  const size = { width: 390, height: 844 };
  assert.equal(routeFitKey(route, false, size, null), null);
  assert.equal(routeFitKey(route, true, { width: 0, height: 844 }, null), null);
  assert.ok(routeFitKey(route, true, size, null));
});

test('layout, mode and route-choice changes preserve the camera; new endpoints refit', async () => {
  const { routeFitKey } = await import('../viewGeometry.js');
  const route = { start: { lat: 30.61, lon: -96.34 }, end: { lat: 30.62, lon: -96.33 } };
  const size = { width: 390, height: 844 };
  const first = routeFitKey(route, true, size, null);
  assert.equal(routeFitKey({ ...route, mode: 'lighting', features: [] }, true, size, first), null);
  assert.equal(routeFitKey(route, true, { width: 844, height: 390 }, first), null);
  const next = { ...route, end: { lat: 30.63, lon: -96.32 } };
  assert.notEqual(routeFitKey(next, true, size, first), first);
  const dragged = routeFitKey(next, true, size, first);
  assert.equal(routeFitKey(next, true, size, dragged), null);
  assert.equal(routeFitKey(route, true, size, dragged), first);
});
