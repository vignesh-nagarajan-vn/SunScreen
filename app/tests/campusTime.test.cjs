const { test } = require('node:test');
const assert = require('node:assert/strict');

test('automatic night mode uses the unrounded calculation boundaries', async () => {
  const { FIRST, LAST, outsideSunHours } = await import('../campusTime.js');
  assert.equal(FIRST, 420);
  assert.equal(LAST, 1200);
  for (const minute of [0, FIRST - 1, LAST + 1, 1439]) {
    assert.equal(outsideSunHours(minute), true, `night at minute ${minute}`);
  }
  for (const minute of [FIRST, FIRST + 1, 720, LAST - 1, LAST]) {
    assert.equal(outsideSunHours(minute), false, `day at minute ${minute}`);
  }
});

test('campus clock uses Chicago time across daylight saving time', async () => {
  const { campusMinutes } = await import('../campusTime.js');
  assert.equal(campusMinutes(new Date('2026-07-01T12:00:00Z')), 420);
  assert.equal(campusMinutes(new Date('2026-12-01T13:00:00Z')), 420);
  assert.equal(campusMinutes(new Date('2026-07-02T05:00:00Z')), 0);
});

test('late-night campus time stays night instead of clamping to the last sun slot', async () => {
  const { campusMinutes, outsideSunHours } = await import('../campusTime.js');
  const minute = campusMinutes(new Date('2026-10-26T02:15:00Z'));
  assert.equal(minute, 21 * 60 + 15);
  assert.equal(outsideSunHours(minute), true);
});
