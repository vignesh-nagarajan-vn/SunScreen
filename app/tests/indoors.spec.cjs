const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixtures = JSON.parse(fs.readFileSync('../tmp/browser-fixtures.json', 'utf8'));

async function setup(page, offline = false) {
  await page.route('**/MapServer/tile/**', route => route.abort());
  await page.route('**/api/route?**', route => {
    if (offline) return route.abort('failed');
    const q = new URL(route.request().url()).searchParams;
    let data = fixtures.default;
    if (q.get('to') === 'zachry_596') data = q.get('mode') === 'lighting' ? fixtures.roomLighting : fixtures.room;
    else if (q.get('from') === 'zachry_596') data = fixtures.roomReverse;
    else if (q.get('from') === 'ilsq' && q.get('to') === 'commons') data = fixtures.mscShortcut;
    return route.fulfill({ json: data });
  });
  await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
}

async function room(page, endpoint = 'To') {
  await page.getByRole('button', { name: new RegExp('^' + endpoint + ':') }).click();
  const input = page.getByRole('textbox', { name: 'Search buildings or addresses' });
  await input.fill('Zach 596');
  await expect(page.getByRole('button', { name: /^Zachry 596/ })).toBeVisible();
  await input.press('Enter');
}

test('room shorthand routes to a canonical entrance and expands only the requested indoor guide', async ({ page }) => {
  await setup(page);
  let searches = 0; page.on('request', r => { if (r.url().includes('/api/search?')) searches++; });
  const request = page.waitForRequest(r => r.url().includes('/api/route?') && new URL(r.url()).searchParams.get('to') === 'zachry_596');
  await room(page); await request;
  await expect(page.getByRole('button', { name: /^To: Zachry 596/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Indoor directions', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Indoor directions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Indoor directions', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/Use the signed elevators to reach Level 5/)).toBeVisible();
  await expect(page.getByText(/Walking estimates cover the outdoor route/)).toBeVisible();
  for (const label of ['Fastest', 'Recommended', 'Max shade'])
    await expect(page.getByRole('button', { name: new RegExp('^' + label + ':') })).toBeVisible();
  expect(searches).toBe(0);
});

test('room departure guidance and map handoff keep the named floor separate from outdoor positioning', async ({ page }) => {
  await setup(page);
  await page.goto('/?intro=0&time=14:00&from=zachry&to=commons');
  await expect(page.getByRole('button', { name: /^To: The Commons/ })).toBeVisible();
  await room(page, 'From');
  await page.getByRole('button', { name: 'Indoor directions', exact: true }).click();
  await expect(page.getByText('Leaving Zachry 596', { exact: true })).toBeVisible();
  await expect(page.getByText(/Take an elevator to Level 1/)).toBeVisible();
});

test('unsupported room numbers do not fall through to address geocoding', async ({ page }) => {
  await setup(page);
  let searches = 0; page.on('request', r => { if (r.url().includes('/api/search?')) searches++; });
  await page.getByRole('button', { name: /^To:/ }).click();
  const input = page.getByRole('textbox', { name: 'Search buildings or addresses' });
  await input.fill('Zach 999'); await input.press('Enter');
  await expect(page.getByText(/Indoor directions aren't mapped for this room/)).toBeVisible();
  expect(searches).toBe(0);
});

test('MSC passage remains a normal Max shade choice with one compact access note', async ({ page }) => {
  await setup(page);
  await page.goto('/?intro=0&time=14:00&from=ilsq&to=commons');
  await expect(page.getByRole('button', { name: /^Max shade:/ })).toBeVisible();
  await page.getByRole('button', { name: /^Max shade:/ }).click();
  await expect(page.getByText(/Check building access/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Indoor directions', exact: true })).toHaveCount(0);
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
});

test('offline room guidance fits a small phone without claiming a live indoor route', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await setup(page, true);
  await room(page);
  await page.getByRole('button', { name: 'Indoor directions', exact: true }).click();
  await expect(page.getByText(/Indoor directions follow the published plan/)).toBeVisible();
  await expect(page.getByText(/1\. Enter Zachry at the mapped level-1 entrance/)).toBeInViewport();
  await expect(page.getByRole('link', { name: /Official floor plan/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: '../tmp/reports/indoor-room-phone.png' });
});
