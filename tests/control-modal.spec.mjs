import { expect, test } from '@playwright/test';

test('control modal is present and draggable', async ({ page }) => {
  await page.goto('/');
  const cm = page.locator('#control-modal');
  await expect(cm).toBeVisible();
  const before = await cm.boundingBox();

  const header = page.locator('#cm-header');
  const hb = await header.boundingBox();
  await page.mouse.move(hb.x + 30, hb.y + 8);
  await page.mouse.down();
  await page.mouse.move(hb.x - 120, hb.y + 140, { steps: 6 });
  await page.mouse.up();

  const after = await cm.boundingBox();
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(30);
});

test('control modal collapses and expands', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#cm-body')).toBeVisible();
  await page.click('#cm-toggle');
  await expect(page.locator('#cm-body')).toBeHidden();
  await page.click('#cm-toggle');
  await expect(page.locator('#cm-body')).toBeVisible();
});

test('control modal config opens settings; reset clears state', async ({ page }) => {
  await page.goto('/');
  const enc = await page.evaluate(() => window.__seed.encodeState('<div id="x">x</div>'));
  await page.goto('/?s=' + encodeURIComponent(enc));

  await page.click('#cm-config');
  await expect(page.locator('#settings-modal')).toBeVisible();
  await page.click('#settings-close');

  await page.click('#cm-reset');
  await expect(page.locator('#bp-prompt')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('s')).toBeNull();
});

test('control modal generates from its own prompt box', async ({ page }) => {
  await page.route('**/api.anthropic.com/v1/messages', route =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: '<div id="cmgen">FROM MODAL</div>' }] }),
    }));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('seed_config_v1', JSON.stringify({
    kind: 'anthropic', anthropic: { apiKey: 'test-key', model: 'claude-opus-4-7' },
    openaiCompat: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: '' },
  })));
  await page.reload();
  await page.fill('#cm-prompt', 'hello');
  await page.click('#cm-generate');
  await expect(page.locator('#cmgen')).toHaveText('FROM MODAL');
});
