import { expect, test } from '@playwright/test';

test('url state codec round-trips html', async ({ page }) => {
  await page.goto('/');
  const html = '<div class="x">héllo <b>world</b> 😀 <script>console.log(1)<\/script></div>';
  const out = await page.evaluate(async (h) => {
    const enc = await window.__seed.encodeState(h);
    const dec = await window.__seed.decodeState(enc);
    return { enc, dec, prefix: enc[0] };
  }, html);
  expect(out.dec).toBe(html);
  expect(out.prefix).toBe('g'); // chromium supports CompressionStream → gzip path
  expect(out.enc).not.toContain('+');
  expect(out.enc).not.toContain('/');
  expect(out.enc).not.toContain('=');
});

test('page restores from ?s= without any network call', async ({ page }) => {
  await page.goto('/');
  const enc = await page.evaluate(() =>
    window.__seed.encodeState('<div id="restored">RESTORED CONTENT</div>'));
  // Prove no generation request fires while restoring.
  await page.route('**/api.anthropic.com/**', route => route.abort());
  await page.goto('/?s=' + encodeURIComponent(enc));
  await expect(page.locator('#restored')).toHaveText('RESTORED CONTENT');
  await expect(page.locator('#bp-prompt')).toHaveCount(0); // bootstrap NOT shown
});

test('bad ?s= falls back to bootstrap', async ({ page }) => {
  await page.goto('/?s=gNOTVALIDbase64!!!');
  await expect(page.locator('#bp-prompt')).toBeVisible();
});

test('renderBootstrap clears ?s= from the url', async ({ page }) => {
  await page.goto('/');
  const enc = await page.evaluate(() => window.__seed.encodeState('<div id="x">x</div>'));
  await page.goto('/?s=' + encodeURIComponent(enc));
  await page.evaluate(() => window.renderBootstrap());
  expect(new URL(page.url()).searchParams.get('s')).toBeNull();
});

test('generating writes ?s= and the result survives reload offline', async ({ page }) => {
  // Mock the Anthropic API so no real key is needed.
  await page.route('**/api.anthropic.com/v1/messages', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: '<div id="gen">GENERATED OK</div>' }] }),
    }));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('seed_config_v1', JSON.stringify({
    kind: 'anthropic', anthropic: { apiKey: 'test-key', model: 'claude-opus-4-7' },
    openaiCompat: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: '' },
  })));
  await page.reload();

  await page.fill('#bp-prompt', 'make a thing');
  await page.click('text=generate →');
  await expect(page.locator('#gen')).toHaveText('GENERATED OK');

  const s = await page.evaluate(() => new URL(location.href).searchParams.get('s'));
  expect(s).toBeTruthy();

  // Reload the produced URL with the network blocked → still restores.
  await page.route('**/api.anthropic.com/**', route => route.abort());
  await page.goto('/?s=' + encodeURIComponent(s));
  await expect(page.locator('#gen')).toHaveText('GENERATED OK');
});
