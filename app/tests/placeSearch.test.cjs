const { test } = require('node:test');
const assert = require('node:assert/strict');
const cases = require('../../tests/fixtures/place-search.json');
const places = require('../places.json').places;

test('campus aliases, codes, accents and ambiguous groups match shared backend cases', async () => {
  const { searchPlaces, exactPlace } = await import('../placeSearch.js');
  for (const c of cases) {
    assert.equal(searchPlaces(places, c.query)[0]?.id ?? null, c.first, c.query);
    assert.equal(exactPlace(places, c.query)?.id ?? null, c.exact, c.query);
  }
});

test('large catalogs have bounded, unique search results and distinct ILSQ/ILCB destinations', async () => {
  const { searchPlaces, exactPlace } = await import('../placeSearch.js');
  assert.ok(places.length >= 350);
  const broad = searchPlaces(places, 'a');
  assert.ok(broad.length <= 40);
  assert.equal(new Set(broad.map(p => p.id)).size, broad.length);
  assert.notDeepEqual(exactPlace(places, 'ILSQ'), exactPlace(places, 'ILCB'));
  assert.ok(places.filter(p => p.category === 'Residence halls').length >= 40);
});
