# URL-encoded state + moveable control modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode the current `#stage` HTML into the URL (`?s=` query param, gzip+base64url) so pages are shareable/restorable, and replace the fixed top-right pill with an always-present, draggable control modal (regenerate, copy share URL, config, reset).

**Architecture:** Single-file app (`index.html`) with one inline `<script>`. We add (a) a URL state codec exposed at `window.__seed`, (b) restore-on-load and write-on-generate hooks around the existing `injectAndExecute` pipeline, and (c) a draggable `#control-modal` element replacing `#bootstrap-pill`, keeping the existing minimalist black-and-white square-box monospace styling.

**Tech Stack:** Vanilla JS in a single HTML file, Tailwind Play CDN, browser Streams API (`CompressionStream`/`DecompressionStream`), Playwright for e2e tests.

---

## File structure

- **Modify:** `index.html` — all app code (markup + inline script).
- **Create:** `tests/url-state.spec.mjs` — codec round-trip, restore-from-URL, write-on-generate (mocked network).
- **Create:** `tests/control-modal.spec.mjs` — modal presence, drag, collapse, config, reset.
- **Modify:** `tests/bootstrap.spec.mjs` — update selectors after the pill is folded into the modal.

Conventions to follow (from existing code): `const $ = id => document.getElementById(id)` helper already exists; styling uses `border-ink`, `shadow-[6px_6px_0_0_#0a0a0a]`, uppercase `tracking-wider` monospace; localStorage keys are versioned (`seed_*_v1`).

---

## Task 1: URL state codec + `window.__seed`

**Files:**
- Modify: `index.html` (inline script — add codec block; expose `window.__seed`)
- Test: `tests/url-state.spec.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/url-state.spec.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/url-state.spec.mjs -g "round-trips"`
Expected: FAIL — `window.__seed` is undefined (`Cannot read properties of undefined`).

- [ ] **Step 3: Add the codec block**

In `index.html`, immediately after the `function makeProvider(cfg) { ... }` block (ends around line 290, before the `SYSTEM PROMPT` comment banner), insert:

```js
  // ==========================================================================
  // URL STATE CODEC  (html <-> ?s= param, gzip+base64url)
  // ==========================================================================

  function bytesToBase64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function base64urlToBytes(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  async function gzipBytes(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzipBytes(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }

  // Format prefix: 'g' = gzip+base64url, 'b' = plain base64url (fallback).
  async function encodeState(html) {
    if (typeof CompressionStream === 'function') {
      return 'g' + bytesToBase64url(await gzipBytes(html));
    }
    return 'b' + bytesToBase64url(new TextEncoder().encode(html));
  }
  async function decodeState(str) {
    if (!str) throw new Error('empty state');
    const fmt = str[0], payload = str.slice(1);
    const bytes = base64urlToBytes(payload);
    if (fmt === 'g') return await gunzipBytes(bytes);
    if (fmt === 'b') return new TextDecoder().decode(bytes);
    throw new Error('unknown state format: ' + fmt);
  }

  function readStateFromUrl() {
    return new URL(location.href).searchParams.get('s');
  }
  function writeStateToUrl(stateStr) {
    const url = new URL(location.href);
    url.searchParams.set('s', stateStr);
    history.replaceState(null, '', url);
  }
  function clearStateFromUrl() {
    const url = new URL(location.href);
    url.searchParams.delete('s');
    history.replaceState(null, '', url);
  }

  // Test/debug hook.
  window.__seed = { encodeState, decodeState, readStateFromUrl, writeStateToUrl, clearStateFromUrl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/url-state.spec.mjs -g "round-trips"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/url-state.spec.mjs
git commit -m "feat: add URL state codec (gzip+base64url) exposed at window.__seed"
```

---

## Task 2: Restore page from `?s=` on load; clear on bootstrap

**Files:**
- Modify: `index.html` (replace final `renderBootstrap();` call; add `restoreOrBootstrap`; clear state inside `renderBootstrap`)
- Test: `tests/url-state.spec.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/url-state.spec.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/url-state.spec.mjs -g "restores from|falls back|clears"`
Expected: FAIL — restored content not present (page always shows bootstrap; `?s=` not cleared).

- [ ] **Step 3: Add `restoreOrBootstrap` and clear-on-bootstrap**

In `index.html`, inside `function renderBootstrap() {`, add a clear call as the **first** line of the function body (immediately after the `{`):

```js
  function renderBootstrap() {
    clearStateFromUrl();
    stage.innerHTML = `
```

Then replace the final initial-render call. Change:

```js
  // ==========================================================================
  // INITIAL RENDER
  // ==========================================================================

  renderBootstrap();
```

to:

```js
  // ==========================================================================
  // INITIAL RENDER
  // ==========================================================================

  async function restoreOrBootstrap() {
    const s = readStateFromUrl();
    if (s) {
      try {
        injectAndExecute(await decodeState(s));
        return;
      } catch (e) {
        console.warn('seed: failed to restore from url —', e);
        // fall through to bootstrap (renderBootstrap clears the bad param)
      }
    }
    renderBootstrap();
  }
  restoreOrBootstrap();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/url-state.spec.mjs`
Expected: PASS (all url-state tests).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/url-state.spec.mjs
git commit -m "feat: restore page from ?s= on load; clear state on bootstrap"
```

---

## Task 3: Write state to URL after a successful generation

**Files:**
- Modify: `index.html` (inside `regenerate`, after `injectAndExecute(html)` in the success path)
- Test: `tests/url-state.spec.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/url-state.spec.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/url-state.spec.mjs -g "writes \\?s="`
Expected: FAIL — after generate, `?s=` is `null` (state never written).

- [ ] **Step 3: Write state after successful injection**

In `index.html`, in `async function regenerate(prompt)`, the success path currently reads:

```js
      injectAndExecute(html);
    } catch (e) {
```

Change it to:

```js
      injectAndExecute(html);
      try { writeStateToUrl(await encodeState(html)); }
      catch (err) { console.warn('seed: failed to encode state to url —', err); }
    } catch (e) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/url-state.spec.mjs -g "writes \\?s="`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/url-state.spec.mjs
git commit -m "feat: write encoded stage HTML to ?s= after each generation"
```

---

## Task 4: Moveable control modal (replaces the pill)

**Files:**
- Modify: `index.html` (replace `#bootstrap-pill` markup; add modal script; remove old `settings-btn`/`reset-btn` handlers; update system-prompt note)
- Modify: `tests/bootstrap.spec.mjs` (selectors)
- Test: `tests/control-modal.spec.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/control-modal.spec.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/control-modal.spec.mjs`
Expected: FAIL — `#control-modal` does not exist.

- [ ] **Step 3: Replace the pill markup with the control modal**

In `index.html`, replace this block:

```html
<!-- Bootstrap pill: ALWAYS visible, outside #stage. Lifeline back to settings + reset. -->
<div id="bootstrap-pill" class="fixed top-4 right-4 z-[9999] flex gap-2">
  <button id="settings-btn"
    class="bg-ink text-paper border border-ink px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider hover:bg-white hover:text-ink transition"
    title="provider settings">config</button>
  <button id="reset-btn"
    class="bg-white border border-ink text-ink px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider hover:bg-ink hover:text-paper transition"
    title="reset to bootstrap UI">reset</button>
</div>
```

with:

```html
<!-- Control modal: ALWAYS present, outside #stage, draggable. Lifeline to regenerate/config/reset. -->
<div id="control-modal" class="fixed z-[9999] w-64 bg-white border border-ink shadow-[6px_6px_0_0_#0a0a0a] font-mono">
  <div id="cm-header" class="flex items-center justify-between bg-ink text-paper px-2 py-1.5 cursor-move select-none touch-none">
    <span class="text-[10px] uppercase tracking-widest">seed · control</span>
    <button id="cm-toggle" class="text-paper text-sm leading-none px-1 hover:opacity-70" title="collapse">–</button>
  </div>
  <div id="cm-body" class="p-2 space-y-2">
    <textarea id="cm-prompt" rows="3" placeholder="describe a new page… (⏎ to generate)"
      class="w-full bg-white border border-ink px-2 py-1 text-[11px] text-ink placeholder:text-stone-400 focus:outline-none resize-none"></textarea>
    <button id="cm-generate"
      class="w-full bg-ink text-paper border border-ink px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-white hover:text-ink transition">generate →</button>
    <div class="grid grid-cols-3 gap-1">
      <button id="cm-copy" class="border border-ink px-1 py-1 text-[9px] uppercase tracking-wider hover:bg-ink hover:text-paper transition" title="copy share url">copy url</button>
      <button id="cm-config" class="border border-ink px-1 py-1 text-[9px] uppercase tracking-wider hover:bg-ink hover:text-paper transition" title="provider settings">config</button>
      <button id="cm-reset" class="border border-ink px-1 py-1 text-[9px] uppercase tracking-wider hover:bg-ink hover:text-paper transition" title="reset to bootstrap">reset</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Replace the old pill handlers with the modal controller**

In `index.html`, the old handlers exist:

```js
  $('settings-btn').onclick = () => {
    syncSettingsUI();
    modal.classList.remove('hidden');
    if (config.kind === 'local') refreshLocalStatus();
  };
  $('settings-close').onclick = () => modal.classList.add('hidden');
```

Change the `settings-btn` handler to a `cm-config` handler (leave `settings-close` and all other settings handlers untouched):

```js
  $('cm-config').onclick = () => {
    syncSettingsUI();
    modal.classList.remove('hidden');
    if (config.kind === 'local') refreshLocalStatus();
  };
  $('settings-close').onclick = () => modal.classList.add('hidden');
```

Then find and **replace** the old reset handler:

```js
  $('reset-btn').onclick = () => {
    if (currentAbort) currentAbort.abort();
    renderBootstrap();
  };
```

with the full modal controller:

```js
  // ---- Control modal: reset, regenerate, copy, drag, collapse ----------------
  $('cm-reset').onclick = () => {
    if (currentAbort) currentAbort.abort();
    renderBootstrap();
  };
  $('cm-generate').onclick = () => regenerate($('cm-prompt').value);
  $('cm-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); regenerate($('cm-prompt').value); }
  });
  $('cm-copy').onclick = async () => {
    const btn = $('cm-copy'), original = btn.textContent, url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = url.length > 100000 ? 'big url' : 'copied';
    } catch { btn.textContent = 'blocked'; }
    setTimeout(() => { btn.textContent = original; }, 1200);
  };

  const cm = $('control-modal');
  const cmHeader = $('cm-header');
  const MODAL_POS_KEY = 'seed_modal_pos_v1';

  function clampPos(left, top) {
    const maxLeft = Math.max(0, window.innerWidth - cm.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - cm.offsetHeight);
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  }
  function setPos(left, top) {
    const p = clampPos(left, top);
    cm.style.left = p.left + 'px';
    cm.style.top = p.top + 'px';
    cm.style.right = 'auto';
  }
  function savePos() {
    localStorage.setItem(MODAL_POS_KEY, JSON.stringify({ left: cm.offsetLeft, top: cm.offsetTop }));
  }
  function restorePos() {
    try {
      const saved = JSON.parse(localStorage.getItem(MODAL_POS_KEY));
      if (saved && typeof saved.left === 'number') { setPos(saved.left, saved.top); return; }
    } catch {}
    setPos(window.innerWidth - cm.offsetWidth - 16, 16); // default: top-right
  }

  let dragging = false, dragDX = 0, dragDY = 0;
  cmHeader.addEventListener('pointerdown', e => {
    if (e.target.closest('#cm-toggle')) return; // don't drag when toggling
    dragging = true;
    dragDX = e.clientX - cm.offsetLeft;
    dragDY = e.clientY - cm.offsetTop;
    cmHeader.setPointerCapture(e.pointerId);
  });
  cmHeader.addEventListener('pointermove', e => {
    if (dragging) setPos(e.clientX - dragDX, e.clientY - dragDY);
  });
  cmHeader.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    cmHeader.releasePointerCapture(e.pointerId);
    savePos();
  });
  window.addEventListener('resize', () => setPos(cm.offsetLeft, cm.offsetTop));

  $('cm-toggle').onclick = () => {
    const collapsed = $('cm-body').classList.toggle('hidden');
    $('cm-toggle').textContent = collapsed ? '+' : '–';
    setPos(cm.offsetLeft, cm.offsetTop); // re-clamp after height change
  };

  restorePos();
```

- [ ] **Step 5: Update the system-prompt note about the floating control**

In `index.html`, in `SYSTEM_PROMPT`, replace this line:

```
- A small floating "config" + "reset" pill exists in the top-right corner outside #stage — do NOT try to remove it. Leave room (~80px) at the top-right so it doesn't overlap your design.
```

with:

```
- A draggable "seed · control" panel (~260px wide, default top-right, outside #stage) floats above the page — do NOT try to remove it. Leave room near its default top-right position so it doesn't overlap critical content.
```

- [ ] **Step 6: Update `tests/bootstrap.spec.mjs` for the folded controls**

In `tests/bootstrap.spec.mjs`, replace the body of the test. The old test references `#settings-btn` and `#reset-btn` which no longer exist. New version:

```js
import { expect, test } from '@playwright/test';

test('bootstrap UI and settings flow render', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/seed/);
  await expect(page.locator('#stage')).toContainText('seed');
  await expect(page.locator('#bp-prompt')).toBeVisible();
  await expect(page.locator('#control-modal')).toBeVisible();
  await expect(page.locator('#cm-config')).toBeVisible();
  await expect(page.locator('#cm-reset')).toBeVisible();

  await page.click('#cm-config');
  await expect(page.locator('#settings-modal')).toBeVisible();
  await expect(page.locator('#anthropic-key')).toBeVisible();
  await expect(page.locator('#anthropic-model')).toHaveValue('claude-opus-4-7');

  await page.selectOption('#provider-kind', 'openai-compat');
  await expect(page.locator('#oac-base')).toBeVisible();
  await page.fill('#oac-model', 'ci-smoke-model');
  await page.click('#settings-save');
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);

  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('seed_config_v1')));
  expect(config.kind).toBe('openai-compat');
  expect(config.openaiCompat.model).toBe('ci-smoke-model');

  await page.click('#cm-reset');
  await expect(page.locator('#bp-prompt')).toBeVisible();
  await expect(page.locator('#stage')).toContainText('seed');
});
```

- [ ] **Step 7: Run the full test suite to verify it passes**

Run: `npx playwright test`
Expected: PASS — all of `url-state.spec.mjs`, `control-modal.spec.mjs`, `bootstrap.spec.mjs`.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/control-modal.spec.mjs tests/bootstrap.spec.mjs
git commit -m "feat: replace pill with draggable control modal (regenerate/copy/config/reset)"
```

---

## Task 5: Manual headed verification with a real API key

This is a manual checkpoint (not an automated test) — the executor pauses here and asks the user for an Anthropic API key, then drives a headed browser.

- [ ] **Step 1: Start the static server**

Run: `python3 -m http.server 4173 --bind 127.0.0.1` (leave running; the page is at `http://127.0.0.1:4173/`).

- [ ] **Step 2: Ask the user for the API key**

Tell the user the headed browser is ready and request their Anthropic API key (entered via the modal's `config`, not committed anywhere).

- [ ] **Step 3: Drive the page (headed Playwright / playwright-cli)**

Open `http://127.0.0.1:4173/`, open `config`, paste the key, save. In the control modal prompt, generate a real page (e.g. "a haiku composer"). Verify:
- the stage renders the generated artifact,
- the URL gains a `?s=...` value,
- `copy url` copies and the copied URL, reopened in a fresh tab, restores the same artifact with the network offline,
- the modal drags, collapses, and stays within the viewport,
- `reset` returns to bootstrap and clears `?s=`.

- [ ] **Step 4: Record the outcome**

Note pass/fail for each check above. If anything fails, file it as a follow-up task and fix before declaring done.

---

## Self-review notes

- **Spec coverage:** codec gzip+base64url + `g`/`b` prefix (Task 1) ✓; `?s=` query param + replaceState + restore/clear flow (Tasks 2–3) ✓; draggable modal with regenerate/copy/config/reset, viewport clamp, persisted position, minimalist style (Task 4) ✓; system-prompt update (Task 4 Step 5) ✓; error handling: bad `?s=` → bootstrap (Task 2), CompressionStream fallback via `b` prefix (Task 1) ✓; tests incl. live headed run (Tasks 1–5) ✓. Out-of-scope items (direct HTML edit, server short links) correctly omitted.
- **Type/name consistency:** `encodeState`/`decodeState`/`readStateFromUrl`/`writeStateToUrl`/`clearStateFromUrl` defined in Task 1 and used unchanged in Tasks 2–4; modal ids (`#control-modal`, `#cm-header`, `#cm-toggle`, `#cm-body`, `#cm-prompt`, `#cm-generate`, `#cm-copy`, `#cm-config`, `#cm-reset`) consistent between markup (Task 4 Step 3) and handlers/tests (Task 4 Steps 4/6, control-modal spec).
- **No placeholders:** every code/edit step shows the exact content and anchor.
