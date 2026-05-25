# seed

A page that grows itself from a single line of text.

You type a description, a configurable LLM provider (Claude, any OpenAI-compatible endpoint, or Chrome's on-device Gemini Nano) returns raw HTML, and it replaces the canvas. Generated pages can call `window.regenerate(prompt)` to reproduce themselves.

The repository serves `index.html` and uses GitHub Actions to run a Playwright smoke test before deploying to GitHub Pages.
