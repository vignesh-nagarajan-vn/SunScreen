const { test, expect } = require('@playwright/test');
const fixtures = require('../../tmp/browser-fixtures.json');

async function mock(page) {
  await page.route('**/MapServer/tile/**', route => route.abort());
  await page.route('**/api/route?**', route => {
    const night = new URL(route.request().url()).searchParams.get('mode') === 'lighting';
    return route.fulfill({ json: fixtures[night ? 'lighting' : 'default'] });
  });
}

test('night mode uses copper accents and offers the official Corps telephone link', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mock(page);
  await page.goto('/?intro=0&time=14:00');
  const escort = page.getByRole('link', { name: 'Call Texas A&M Corps escort at 979-845-6789' });
  await expect(escort).toHaveCount(0);
  await page.getByRole('switch', { name: 'Night mode' }).click();
  await expect(escort).toBeVisible();
  // Inspect the dial target without placing an actual call.
  await expect(escort).toHaveAttribute('href', 'tel:+19798456789');
  await expect(escort).toHaveCSS('background-color', 'rgb(51, 41, 42)');
  await expect(page.getByRole('switch', { name: 'Night mode' })).toHaveCSS('background-color', 'rgb(229, 154, 114)');
  await expect(page.getByText('Streetlight routing', { exact: true })).toHaveCSS('color', 'rgb(243, 238, 238)');
  await expect(page.getByRole('button', { name: /^Most lit:/ })).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane path[stroke="#c64b32"]').first()).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane path[stroke="#d77887"]')).toHaveCount(0);
  await expect(page.getByText(/Weekdays 6 p.m.–7 a.m./)).toBeVisible();
  await page.screenshot({ path: '../tmp/reports/night-red-desktop.png' });
  await page.getByRole('switch', { name: 'Night mode' }).click();
  await expect(escort).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Max shade:/ })).toBeVisible();
});

test('night escort remains available on small phones when custom routing fails', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mock(page);
  await page.goto('/?intro=0&time=14:00');
  await page.getByRole('switch', { name: 'Night mode' }).click();
  await expect(page.getByRole('link', { name: /^Call Texas A&M Corps escort/ })).toBeVisible();
  await page.unroute('**/api/route?**');
  await page.route('**/api/route?**', route => route.fulfill({ status: 400, json: { detail: 'No walking path connects those two points.' } }));
  await page.getByLabel('Swap start and destination').click();
  await expect(page.getByText('No walking path connects those two points.')).toBeAttached();
  await expect(page.getByRole('link', { name: /^Call Texas A&M Corps escort/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect((await page.locator('.leaflet-container').boundingBox()).height).toBeGreaterThan(60);
  await page.screenshot({ path: '../tmp/reports/night-red-small-phone.png' });
});
