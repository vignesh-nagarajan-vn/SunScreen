const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixtures = JSON.parse(fs.readFileSync('../tmp/browser-fixtures.json', 'utf8'));

async function setup(page, offline = false) {
  await page.route('**/MapServer/tile/**', route => route.abort());
  await page.route('**/api/route?**', route => {
    if (offline) return route.abort('failed');
    const q = new URL(route.request().url()).searchParams;
    const data = q.get('from') === 'ilsq' && q.get('to') === 'ilcb' ? fixtures.ilsqToIlcb
      : fixtures.placeTrips[q.get('from')] ?? fixtures.default;
    return route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/?intro=0&time=14:00');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
}

const input = page => page.getByRole('textbox', { name: 'Search buildings or addresses' });

test('codes and common spellings select canonical destinations without address lookup', async ({ page }) => {
  await setup(page);
  let lookups = 0; page.on('request', r => { if (r.url().includes('/api/search?')) lookups++; });
  for (const [query, pid, name] of [
    ['ILSQ', 'ilsq', 'Instructional Laboratory & Innovative Learning Building'],
    ['ILCB', 'ilcb', 'Innovative Learning Classroom Building'],
    ['Buetul', 'beutel', 'Beutel Health Center'],
  ]) {
    await page.getByRole('button', { name: /^From:/ }).click();
    await input(page).fill(query);
    await expect(page.getByRole('button', { name: new RegExp('^' + name.replace('&', '&')) })).toBeVisible();
    const request = page.waitForRequest(r => r.url().includes('/api/route?') && new URL(r.url()).searchParams.get('from') === pid);
    await input(page).press('Enter'); await request;
    await expect(page.getByRole('button', { name: `From: ${name}. Change` })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  }
  expect(lookups).toBe(0);
});

test('ILSQ and ILCB remain distinct route endpoints', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: /^From:/ }).click(); await input(page).fill('ILSQ'); await input(page).press('Enter');
  await page.getByRole('button', { name: /^To:/ }).click(); await input(page).fill('ILCB');
  const request = page.waitForRequest(r => r.url().includes('/api/route?') && new URL(r.url()).searchParams.get('to') === 'ilcb');
  await input(page).press('Enter');
  const q = new URL((await request).url()).searchParams;
  expect(q.get('from')).toBe('ilsq'); expect(q.get('to')).toBe('ilcb');
  await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
});

test('dorms and dining are searchable on a small phone with official codes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await setup(page);
  for (const [query, name, category] of [['ASTO', 'Aston Residence Hall', 'Residence halls'],
    ['Hullabaloo', 'Hullabaloo Residence Hall', 'Residence halls'], ['Duncan', 'Duncan Dining Hall', 'Dining']]) {
    await page.getByRole('button', { name: /^From:/ }).click(); await input(page).fill(query);
    await expect(page.getByRole('button', { name: new RegExp('^' + name) })).toBeVisible();
    await expect(page.getByText(new RegExp('· ' + category + '$'))).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: '../tmp/reports/campus-place-search.png' });
    await input(page).press('Enter');
    await expect(page.getByRole('button', { name: /^Recommended:/ })).toBeVisible();
  }
});

test('ambiguous residence groups require a choice and offline aliases still appear', async ({ page }) => {
  await setup(page, true);
  await page.getByRole('button', { name: /^From:/ }).click(); await input(page).fill('white creek');
  await input(page).press('Enter');
  await expect(page.getByText('Choose a campus place below.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^White Creek Apartments A \(Building 1590\)$/ })).toBeVisible();
  await input(page).fill('Buetul');
  await expect(page.getByRole('button', { name: /^Beutel Health Center/ })).toBeVisible();
});

test('late address results cannot replace newer campus-code suggestions', async ({ page }) => {
  await setup(page);
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/search?**', async route => {
    await gate;
    try { await route.fulfill({ json: { results: [{ name: 'Stale address', lat: 30.615, lon: -96.34 }] },
      headers: { 'access-control-allow-origin': '*' } }); } catch { /* cancelled query */ }
  });
  await page.getByRole('button', { name: /^From:/ }).click(); await input(page).fill('unmatched address qzx');
  const request = page.waitForRequest(r => r.url().includes('/api/search?'));
  await input(page).press('Enter'); await request;
  await input(page).fill('ILCB'); release();
  await expect(page.getByRole('button', { name: /^Innovative Learning Classroom Building/ })).toBeVisible();
  await expect(page.getByText('Stale address', { exact: true })).toHaveCount(0);
});
