const { test } = require('node:test');
const assert = require('node:assert/strict');

test('corrupt or out-of-range saved preferences return safe defaults', async () => {
  const { savedLimits, DEFAULT_LIMITS } = await import('../routePreferences.js');
  for (const value of [null, [], 'custom', {}, { recommended_pct: '20', max_detour_pct: 50 },
    { recommended_pct: -1, max_detour_pct: 30 }, { recommended_pct: 10, max_detour_pct: Infinity },
    { recommended_pct: NaN, max_detour_pct: 30 }, { recommended_pct: 40, max_detour_pct: 30 },
    { recommended_pct: 50, max_detour_pct: 101 }]) assert.deepEqual(savedLimits(value), DEFAULT_LIMITS);
});

test('valid boundary settings survive storage without unrelated fields', async () => {
  const { savedLimits, validLimits } = await import('../routePreferences.js');
  for (const [recommended_pct, max_detour_pct] of [[0, 0], [0, 100], [30, 30], [100, 100]]) {
    const value = { recommended_pct, max_detour_pct };
    assert.ok(validLimits(value));
    assert.deepEqual(savedLimits({ ...value, ignored: true }), value);
  }
});

test('old cached or server responses match only default limits', async () => {
  const { matchesLimits, DEFAULT_LIMITS } = await import('../routePreferences.js');
  assert.ok(matchesLimits({}, DEFAULT_LIMITS));
  const custom = { recommended_pct: 20, max_detour_pct: 50 };
  assert.ok(!matchesLimits({}, custom));
  assert.ok(!matchesLimits({ route_limits: DEFAULT_LIMITS }, custom));
  assert.ok(matchesLimits({ route_limits: { ...custom, effective_recommended_pct: 10 } }, custom));
});
