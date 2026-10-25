const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixtures = JSON.parse(fs.readFileSync('../tmp/browser-fixtures.json', 'utf8'));

async function mock(page, kind = 'default') {
  await page.route('**/api/route?**', async route => {
    if (kind === 'offline') return route.abort('failed');
    const data = kind === 'invalid' ? {} : structuredClone(fixtures[kind]);
    await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });
  // Tile outages must not prevent the bundled map from drawing cached routes.
  await page.route('**/MapServer/tile/**', route => route.abort());
}

test('phone shows one map and exactly three normal route choices', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mock(page); await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  for (const label of ['Fastest', 'Recommended', 'Max shade'])
    await expect(page.getByRole('button', { name: new RegExp('^' + label + ':') })).toBeVisible();
  // The night mode toggle is the only switch; no indoor routing controls.
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(page.getByRole('switch', { name: 'Night mode' })).toHaveCount(1);
  await expect(page.getByText('Via buildings', { exact: true })).toHaveCount(0);
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
  await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(errors).toEqual([]);
  await page.screenshot({ path: '../tmp/reports/mobile-default.png' });
});

test('small phone keeps the map and endpoints accessible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mock(page); await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^From:/ })).toBeVisible();
  const map = await page.locator('.leaflet-container').boundingBox();
  expect(map.height).toBeGreaterThan(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: '../tmp/reports/mobile-small.png' });
});

test('building traversal uses the usual route card without indoor controls', async ({ page }) => {
  await mock(page, 'building'); await page.goto('/?intro=0&time=14:00&to=langford');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  await expect(page.getByText(/Check building access/)).toBeVisible();
  // The night mode toggle is the only switch; no indoor routing controls.
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(page.getByRole('switch', { name: 'Night mode' })).toHaveCount(1);
  await expect(page.getByText(/Choose a building|Floor plan|Preloaded layout/)).toHaveCount(0);
  await page.screenshot({ path: '../tmp/reports/mobile-building.png' });
});

test('offline and malformed API responses retain three cached choices', async ({ page }) => {
  for (const kind of ['offline', 'invalid']) {
    await page.unroute('**/api/route?**');
    await mock(page, kind); await page.goto('/?intro=0&time=14:00');
    await expect(page.getByText(/Offline: showing saved routes/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Fastest:/ })).toBeVisible();
  }
});

test('repeated selection does not accumulate old map paths', async ({ page }) => {
  await mock(page); await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^Max shade:/ })).toBeVisible();
  const before = await page.locator('.leaflet-overlay-pane path').count();
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /^Max shade:/ }).click();
    await page.getByRole('button', { name: /^Recommended:/ }).click();
  }
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(before);
  await expect(page.locator('.leaflet-tooltip')).toHaveCount(2);
});

test('address names are rendered as literal text', async ({ page }) => {
  const malicious = '<img src=x onerror="window.injected=true">';
  await page.route('**/api/search?**', route => route.fulfill({ json: {
    results: [{ ...fixtures.default.start, id: null, name: malicious }],
  } }));
  await page.route('**/api/route?**', route => {
    const data = structuredClone(fixtures.default); data.start.name = malicious;
    return route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/?intro=0&time=14:00');
  await page.getByRole('button', { name: /^From:/ }).click();
  await page.getByLabel('Search buildings or addresses').fill('test address');
  await page.getByLabel('Search buildings or addresses').press('Enter');
  await page.getByText(malicious, { exact: true }).click();
  await expect(page.locator('.leaflet-tooltip').filter({ hasText: malicious })).toBeVisible();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('Now uses campus time even on a device in Tokyo', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-26T19:04:00Z') });
  await mock(page);
  const request = page.waitForRequest(r => r.url().includes('/api/route?'));
  await page.goto('/?intro=0&time=invalid');
  expect(new URL((await request).url()).searchParams.get('time')).toBe('14:00');
  await context.close();
});

test('late responses cannot overwrite a newer trip', async ({ page }) => {
  await page.route('**/api/route?**', async route => {
    const reversed = new URL(route.request().url()).searchParams.get('from') === 'zachry';
    const data = structuredClone(reversed ? fixtures.reverse : fixtures.default);
    if (reversed) {
      data.start.name = 'Stale response';
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    try { await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } }); }
    catch { /* The old request is expected to be aborted. */ }
  });
  await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  await page.getByLabel('Swap start and destination').click();
  await page.getByLabel('Swap start and destination').click();
  await expect(page.getByRole('button', { name: /^From: The Commons/ })).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator('.leaflet-tooltip')).toHaveCount(2);
  await expect(page.getByText('Stale response', { exact: true })).toHaveCount(0);
});

test('failed trip clears the previous routes from the map', async ({ page }) => {
  await mock(page); await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  await page.unroute('**/api/route?**');
  await page.route('**/api/route?**', route => route.fulfill({ status: 400,
    json: { detail: 'No walking path connects those two points.' }, headers: { 'access-control-allow-origin': '*' } }));
  await page.getByLabel('Swap start and destination').click();
  await expect(page.getByText('No walking path connects those two points.')).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
  await expect(page.locator('.endpoint-pin')).toHaveCount(2);
});

test('desktop keeps the same three route choices', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mock(page); await page.goto('/?intro=0&time=14:00');
  for (const label of ['Fastest', 'Recommended', 'Max shade'])
    await expect(page.getByRole('button', { name: new RegExp('^' + label + ':') })).toBeVisible();
  expect((await page.locator('.leaflet-container').boundingBox()).height).toBeGreaterThan(700);
});
