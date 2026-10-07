# Generated Jetty library in Paper

Run `bun run paper:capture` with Paper desktop open and its local MCP server enabled in
`~/.codex/config.toml`. The target is the existing **jettyv2** file. Output goes to
`perf/out/paper`; use `--out /absolute/path` to keep screenshots and HTML elsewhere.
Use `--only 'Area/state'` (substring match) or `--only Foundations` while fixing a capture.

The script clones the perf lab's golden home, writes schema-checked fixture snapshots
while that clone is stopped, then starts the echo server and Vite on free ports. GitHub
runs in replay mode. Browser input and screenshots go through `perf/driver.ts`. A
`finally` block closes the browser and stops both owned processes. Never point fixtures
at your normal Jetty home, or run this against the normal development servers.

`views.ts` is the capture registry: add a named area/state, route, readiness condition,
optional UI actions and theme list there. `fixtures.ts` holds states the echo agent cannot
produce. The serializer measures the real DOM, resolves its computed styles and emits
editable text in Geist/Geist Mono plus inline SVG. It uses absolute geometry to preserve
layouts that Paper's flex importer cannot express (grid, tables and scrolled content).
Shadow renderers, canvas, video and unsupported CSS masks become CDP screenshot regions.

Only `App — <Area>` pages are created or refreshed. Existing generated artboards keep
identity; their generated children are replaced. No file or page is deleted or renamed.
The existing exploration tokens are untouched. Generated Tailwind v4 tokens use the
`app` namespace (`--color-app-background` is dark; `--color-app-light-background` and
`--color-app-oled-background` hold alternatives). Main screens and Foundations have
light/OLED variants; other states are dark. States go left to right; themes go top to bottom.

Each run saves a manifest, self-contained HTML, source screenshots, Paper screenshots
and raster regions. Compare each source/Paper pair before accepting an artboard. Fix the
serializer or state setup and rerun; do not hand-maintain the imported layers. Dated
design explorations belong on other pages and are never capture targets.
