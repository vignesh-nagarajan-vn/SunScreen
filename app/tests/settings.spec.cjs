const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixtures = JSON.parse(fs.readFileSync('../tmp/browser-fixtures.json', 'utf8'));

async function mock(page, fail = false) {
  await page.route('**/api/route?**', route => {
    if (fail) return route.abort('failed');
    const q = new URL(route.request().url()).searchParams;
    const custom = Number(q.get('recommended_pct')) === 20;
    const key = q.get('mode') === 'lighting' ? (custom ? 'lightingCustom' : 'lighting') : (custom ? 'custom' : 'default');
    return route.fulfill({ json: fixtures[key], headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('**/MapServer/tile/**', route => route.abort());
}

async function open(page) {
  await page.getByRole('button', { name: 'Route settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Route settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Route settings' })).toBeVisible();
}

async function customize(page, night = false) {
  const recommended = page.getByRole('slider', { name: 'Recommended extra distance' });
  await recommended.focus();
  await recommended.press('ArrowRight'); await recommended.press('ArrowRight');
  await expect(recommended).toHaveAttribute('aria-valuenow', '20');
  const maximum = page.getByRole('slider', { name: `${night ? 'Most lit' : 'Max shade'} extra distance` });
  await maximum.focus();
  for (let i = 0; i < 4; i++) await maximum.press('ArrowRight');
  await expect(maximum).toHaveAttribute('aria-valuenow', '50');
}

test('small phone keeps settings with Night mode on the map and opens only on demand', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mock(page); await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('heading', { name: 'Route settings' })).toHaveCount(0);
  const gear = page.getByRole('button', { name: 'Route settings', exact: true });
  await expect(gear).toBeVisible();
  const [g, toggle] = await Promise.all([gear.boundingBox(), page.getByRole('switch', { name: 'Night mode' }).boundingBox()]);
  // Both sit in the column of round buttons floating over the map.
  expect(Math.abs(g.x - toggle.x)).toBeLessThan(2);
  expect(g.y - toggle.y).toBeGreaterThan(0);
  expect(g.y - toggle.y).toBeLessThan(70);
  expect((await page.locator('.leaflet-container').boundingBox()).height).toBeGreaterThan(60);
  await open(page);
  await expect(page.getByText(/Higher limits can mean longer walks/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(gear).toBeFocused();
});

test('Apply sends custom limits, persists them and retains three normal choices', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mock(page); await page.goto('/?intro=0&time=14:00');
  await open(page); await customize(page);
  await expect(page.getByText(/Long detour: up to 50% farther/)).toBeVisible();
  await page.screenshot({ path: '../tmp/reports/route-settings-light.png' });
  const applied = page.waitForRequest(r => r.url().includes('recommended_pct=20') && r.url().includes('max_detour_pct=50'));
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await applied;
  await expect(page.getByText(/Custom limits: Recommended \+20%; Max shade \+50%/)).toBeVisible();
  for (const label of ['Fastest', 'Recommended', 'Max shade'])
    await expect(page.getByRole('button', { name: new RegExp('^' + label + ':') })).toBeVisible();
  await page.reload(); await open(page);
  await expect(page.getByRole('slider', { name: 'Recommended extra distance' })).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByRole('slider', { name: 'Max shade extra distance' })).toHaveAttribute('aria-valuenow', '50');
  expect(errors).toEqual([]);
});

test('Cancel and Escape discard drafts, inverted limits cannot be applied', async ({ page }) => {
  await mock(page); await page.goto('/?intro=0&time=14:00');
  await open(page); await customize(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await open(page);
  const rec = page.getByRole('slider', { name: 'Recommended extra distance' });
  await expect(rec).toHaveAttribute('aria-valuenow', '10');
  await rec.focus(); await rec.press('End');
  await expect(page.getByText(/Max shade must allow at least/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset to 10% / 30%' }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Route settings' })).toHaveCount(0);
});

test('custom limits cannot silently use default offline routes; reset restores fallback', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sunscreen-route-limits', JSON.stringify({ recommended_pct: 20, max_detour_pct: 50 })));
  await mock(page, true); await page.goto('/?intro=0&time=14:00');
  await expect(page.getByText(/Custom route limits need a connection/)).toBeVisible();
  await expect(page.getByText(/Offline: showing saved routes/)).toHaveCount(0);
  await open(page); await page.getByRole('button', { name: 'Reset to 10% / 30%' }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText(/Offline: showing saved routes/)).toBeVisible();
});

test('night settings retain theme and update lighting routes', async ({ page }) => {
  await mock(page); await page.goto('/?intro=0&time=14:00');
  await page.getByRole('switch', { name: 'Night mode' }).click();
  await expect(page.getByText('Streetlight routing', { exact: true })).toBeVisible();
  await open(page); await customize(page, true);
  await expect(page.getByText(/^Lamp locations are estimates/)).toBeVisible();
  await page.screenshot({ path: '../tmp/reports/route-settings-dark.png' });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText(/Custom limits: Recommended \+20%; Most lit \+50%/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Most lit:/ })).toBeVisible();
});

test('touching a slider updates its percentage and old servers cannot ignore it', async ({ page }) => {
  await mock(page);
  await page.unroute('**/api/route?**');
  await page.route('**/api/route?**', route => route.fulfill({ json: fixtures.default, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/?intro=0&time=14:00'); await open(page);
  const rec = page.getByRole('slider', { name: 'Recommended extra distance' });
  const box = await rec.boundingBox();
  await rec.click({ position: { x: box.width * .2, y: box.height / 2 } });
  await expect(rec).toHaveAttribute('aria-valuenow', '20');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText(/Custom route limits need a connection and an updated server/)).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
});
