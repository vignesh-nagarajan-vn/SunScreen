const { test, expect } = require('@playwright/test');
const saved = require('../fallback.json')['14:00'];
const area = require('../places.json');
const byId = Object.fromEntries(area.places.map(p => [p.id, p]));

async function setup(page, offline = false) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/MapServer/tile/**', route => route.abort());
  await page.route('**/api/route?**', route => {
    if (offline) return route.abort('failed');
    const q = new URL(route.request().url()).searchParams;
    const data = structuredClone(saved);
    data.start = byId[q.get('from')] ?? data.start;
    data.end = byId[q.get('to')] ?? data.end;
    return route.fulfill({ json: data });
  });
  await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
}

async function showMSC(page) {
  // The default trip is east of MSC. Browse the map, just as a user would.
  const map = page.locator('.leaflet-container');
  await map.focus(); await map.press('Minus'); await map.press('Minus');
  await expect(page.getByRole('button', { name: 'About Memorial Student Center', exact: true })).toBeVisible();
}

test('MSC details do not change a trip until Directions is chosen', async ({ page }) => {
  await setup(page);
  await showMSC(page);
  let requests = 0; page.on('request', r => { if (r.url().includes('/api/route?')) requests++; });
  await page.getByRole('button', { name: 'About Memorial Student Center', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Memorial Student Center' })).toBeVisible();
  await expect(page.getByText('Student gathering spaces and MSC dining.')).toBeVisible();
  expect(requests).toBe(0);
  const request = page.waitForRequest(r => r.url().includes('/api/route?'));
  await page.getByRole('button', { name: 'Directions', exact: true }).click();
  const q = new URL((await request).url()).searchParams;
  expect(q.get('from')).toBe('commons'); expect(q.get('to')).toBe('msc');
  await expect(page.getByRole('button', { name: /^To: Memorial Student Center/ })).toBeVisible();
  for (const label of ['Fastest', 'Recommended', 'Max shade'])
    await expect(page.getByRole('button', { name: new RegExp('^' + label + ':') })).toBeVisible();
});

test('keyboard selection of the Langford café can set a canonical start', async ({ page }) => {
  await setup(page);
  const marker = page.getByRole('button', { name: 'About Langford Architecture', exact: true });
  await marker.focus(); await marker.press('Enter');
  await expect(page.getByRole('heading', { name: 'Langford Architecture' })).toBeVisible();
  await expect(page.getByText(/Azimuth Café is inside Langford A/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close place details' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Start here', exact: true })).toBeFocused();
  const request = page.waitForRequest(r => r.url().includes('/api/route?'));
  await page.keyboard.press('Enter');
  const q = new URL((await request).url()).searchParams;
  expect(q.get('from')).toBe('langford'); expect(q.get('to')).toBe('zachry');
  await expect(page.getByRole('button', { name: /^From: Langford Architecture/ })).toBeVisible();
});

test('an endpoint can be inspected and cannot become both endpoints', async ({ page }) => {
  await setup(page);
  await page.locator('.endpoint-pin[title="Drag start"]').click();
  await expect(page.getByRole('heading', { name: 'The Commons' })).toBeVisible();
  await expect(page.getByText('Your current start')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Directions', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to routes', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
});

test('closing or escaping a highlight restores routes and repeated taps do not accumulate markers', async ({ page }) => {
  await setup(page);
  await showMSC(page);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'About Memorial Student Center', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Memorial Student Center' })).toBeVisible();
    if (i === 1) await page.keyboard.press('Escape');
    else if (i === 2) {
      const box = await page.locator('.leaflet-container').boundingBox();
      await page.locator('.leaflet-container').click({ position: { x: box.width - 40, y: 60 } });
    } else await page.getByRole('button', { name: 'Close place details' }).click();
    await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  }
  const ids = await page.locator('.place-marker').evaluateAll(nodes => nodes.map(n => n.dataset.placeId));
  expect(new Set(ids).size).toBe(ids.length); expect(ids.length).toBeLessThanOrEqual(28);
  await expect(page.locator('.endpoint-pin')).toHaveCount(2);
  await page.screenshot({ path: '../tmp/reports/building-highlights-desktop.png' });
});

test('pick-on-map preserves the browsed view and hides highlights until cancelled', async ({ page }) => {
  await setup(page);
  await showMSC(page);
  await expect(page.locator('.leaflet-container')).not.toHaveClass(/leaflet-zoom-anim/);
  await page.getByRole('button', { name: 'About Memorial Student Center', exact: true }).click();
  await page.getByRole('button', { name: /^To:/ }).click();
  await page.clock.install();
  await page.getByRole('button', { name: /Pick on map/ }).click();
  await page.clock.runFor(100);
  await expect(page.getByText('Tap the map to set your destination')).toBeVisible();
  await expect(page.locator('.place-marker')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Memorial Student Center' })).toHaveCount(0);
  await page.getByText('Cancel', { exact: true }).click();
  // Flush the old 50 ms layout-refit window deterministically. Cancelling a
  // picker on desktop does not resize the map or change the trip.
  await page.clock.runFor(100);
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'About Memorial Student Center', exact: true })).toBeVisible();
  await page.clock.resume();
  await page.getByRole('button', { name: /^To:/ }).click();
  await page.getByRole('button', { name: /Pick on map/ }).click();
  const map = page.locator('.leaflet-container'), box = await map.boundingBox();
  const request = page.waitForRequest(r => r.url().includes('/api/route?'));
  await map.click({ position: { x: box.width / 2, y: box.height * 0.65 } });
  const q = new URL((await request).url()).searchParams;
  expect(q.get('from')).toBe('commons');
  expect(q.get('to')).toMatch(/^\d+\.\d+,-\d+\.\d+$/);
  await expect(page.getByRole('button', { name: /^To: Dropped pin/ })).toBeVisible();
});

test('small-phone offline highlights fit the existing bottom card in night mode', async ({ page }) => {
  await setup(page, true);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('switch', { name: 'Night mode' }).click();
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  await page.locator('.endpoint-pin[title="Drag start"]').click();
  await expect(page.getByRole('heading', { name: 'The Commons' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start here', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect((await page.locator('.leaflet-container').boundingBox()).height).toBeGreaterThan(60);
  await page.screenshot({ path: '../tmp/reports/building-highlights-phone-night.png' });
  await page.getByRole('button', { name: 'Close place details' }).click();
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
});
