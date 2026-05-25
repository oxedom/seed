# seed.

**seed · a self modifying webpage.**

You type a description, a configurable LLM provider (Claude, OpenAI, any OpenAI-compatible endpoint, or Chrome's on-device Gemini Nano) returns raw HTML, and it replaces the canvas. Generated pages can call `window.regenerate(prompt)` to reproduce themselves.

The full state of the page is encoded into the URL: each generated page is gzip-compressed and base64url-encoded into the `?s=` query parameter, so any page can be restored or shared by link alone — no server, no storage. A draggable control panel (regenerate, copy share URL, config, reset) floats above the page and survives every generation.

The repository serves `index.html` and deploys it to GitHub Pages via GitHub Actions.
