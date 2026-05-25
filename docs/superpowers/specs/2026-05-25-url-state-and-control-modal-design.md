# URL-encoded page state + moveable control modal

**Date:** 2026-05-25
**Status:** Approved

## Problem

In `seed`, generated HTML is ephemeral — only the last prompt persists (localStorage). There is no way to share or restore a generated page. Controls (config/reset) live in a fixed top-right pill.

We want:
1. The current stage HTML encoded into the URL so a page is shareable and restorable by link alone.
2. An always-present, moveable control modal for regenerating and sharing, folding in the existing config/reset controls.

## Architecture

The app stays a single file (`index.html`). Two concerns are added to the existing inline script:

- **URL state codec** — converts the current stage HTML to a URL-safe string and back.
- **Moveable control modal** — replaces the fixed `#bootstrap-pill`; becomes the always-present floating control surface.

The `#stage` injection pipeline (`injectAndExecute`) is unchanged; new code hooks into the load and successful-regenerate paths to read/write URL state.

## URL state codec

- **Encode:** `html → gzip (CompressionStream) → bytes → base64url`. Written to the `?s=<value>` query param via `history.replaceState` (no reload, no history spam).
- **Decode:** reverse — `base64url → bytes → gunzip (DecompressionStream) → html`.
- Both are async (Streams API). Helpers: `encodeState(html) → Promise<string>`, `decodeState(str) → Promise<string>`.
- A 1-char format prefix leads the value: `g` = gzip+base64url, `b` = plain base64url. Decode dispatches on the prefix. If `CompressionStream` is unavailable, encode falls back to plain base64 (`b` prefix).

### Data flow

- **On load:** if `?s=` present → `decodeState` → `injectAndExecute(html)` (no network). On decode failure → `renderBootstrap()` + inline note. If absent → `renderBootstrap()`.
- **On successful regenerate:** after `injectAndExecute`, call `encodeState(html)` and update `?s=`.
- **On reset / bootstrap render:** remove `?s=` from the URL.

## Moveable control modal

Replaces `#bootstrap-pill`. Always present, draggable, same minimalist style (`border-ink`, `shadow-[6px_6px_0_0_#0a0a0a]`, uppercase monospace, square corners). Contents:

- **Drag handle / header bar** — grab to move; collapse/expand toggle so it doesn't block page content.
- **Regenerate** — compact prompt textarea + `generate →` button → `window.regenerate(value)`.
- **Copy share URL** — copies the current `?s=` URL to clipboard; brief "copied" state; warns if the URL is very long (> ~100k chars).
- **Config** — opens the existing settings modal (unchanged).
- **Reset** — back to bootstrap, clears `?s=`.

Dragging clamps the modal to the viewport. Position is persisted to localStorage and restored on load. Default position: top-right (current pill location).

## System prompt update

The system prompt currently states "a small floating config + reset pill exists in the top-right corner… leave room (~80px)". Update this text to describe the new moveable modal so generated pages leave room for it and do not try to remove it.

## Error handling

- Decode failure on load → bootstrap + inline note ("couldn't restore page from URL").
- `CompressionStream`/`DecompressionStream` unavailable → fall back to plain base64 via the `b` format prefix.
- Generation errors unchanged (existing error card).

## Testing (Playwright)

- **Codec round-trip** (no network): expose `window.__seed.encodeState/decodeState`; encode known HTML, decode, assert equality.
- **Restore from URL** (no network): load with `?s=<encoded fixture>`; assert stage shows the content and no API call fired.
- **Modal**: visible on load; draggable (position changes after a drag); collapse toggle works; config opens settings; reset clears `?s=`.
- **Live generation** (headed, real API key, provided manually): type a prompt → generate → assert `?s=` populates and stage renders; reload the same URL → identical content restored offline; copy-share works.
- Update existing `bootstrap.spec.mjs` for the folded controls.

## Out of scope (YAGNI)

- Direct HTML source editing in the modal.
- Server-side short links / persistence.
- Undo/redo history beyond browser back.
