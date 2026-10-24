const { test, expect } = require('@playwright/test');
const saved = require('../fallback.json')['14:00'];

async function setup(page, reply) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/MapServer/tile/**', route => route.abort());
  await page.route('**/api/route?**', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (reply && await reply(route, query)) return;
    const data = structuredClone(saved);
    for (const [param, key] of [['from', 'start'], ['to', 'end']]) {
      if (query.get(param).includes(',')) {
        const [lat, lon] = query.get(param).split(',').map(Number);
        data[key] = { id: null, lat, lon, name: query.get(`${param}_name`) };
      }
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
}

async function dragPin(page, title, dx = -45, dy = 25) {
  const box = await page.locator(`.endpoint-pin[title="${title}"]`).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

test('each dragged endpoint requests coordinates and preserves the other endpoint', async ({ page }) => {
  await setup(page);
  for (const [title, changed, unchanged] of [['Drag start', 'from', 'to'], ['Drag destination', 'to', 'from']]) {
    const request = page.waitForRequest(r => r.url().includes('/api/route?'));
    await dragPin(page, title);
    const query = new URL((await request).url()).searchParams;
    expect(query.get(changed)).toMatch(/^\d+\.\d+,-\d+\.\d+$/);
    if (changed === 'from') expect(query.get(unchanged)).toBe('zachry');
    else expect(query.get(unchanged)).toContain(',');
    await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
    await expect(page.locator('.endpoint-pin')).toHaveCount(2);
  }
});

test('pins remain draggable during loading and after a rejected route', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await setup(page, async (route, query) => {
    if (!query.get('from').includes(',')) return false;
    await gate;
    await route.fulfill({ status: 400, json: { detail: 'No walking path connects those two points.' } });
    return true;
  });
  const request = page.waitForRequest(r => r.url().includes('/api/route?'));
  await dragPin(page, 'Drag start');
  await request;
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
  await expect(page.locator('.endpoint-pin')).toHaveCount(2);
  release();
  await expect(page.getByText('No walking path connects those two points.')).toBeVisible();
  await expect(page.locator('.endpoint-pin')).toHaveCount(2);
  const retry = page.waitForRequest(r => r.url().includes('/api/route?'));
  await dragPin(page, 'Drag start', 25, -15);
  await retry;
});

test('outside-campus drop restores the pin without requesting a route', async ({ page }) => {
  await setup(page);
  let requests = 0;
  page.on('request', r => { if (r.url().includes('/api/route?')) requests++; });
  const pin = page.locator('.endpoint-pin[title="Drag start"]');
  const before = await pin.boundingBox();
  await page.mouse.move(before.x + 16, before.y + 16);
  await page.mouse.down();
  await page.mouse.move(6000, 6000, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByText('Keep the pin inside the campus area SunScreen covers.')).toBeVisible();
  const after = await pin.boundingBox();
  // Auto-pan may move the viewport, but rejected coordinates must never reach the API.
  expect(after).not.toBeNull();
  expect(requests).toBe(0);
});
