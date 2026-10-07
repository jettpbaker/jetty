# Generated Jetty library in Paper

Run `bun run paper:capture` with Paper desktop open and its local MCP server enabled in
`~/.codex/config.toml`. The target is the existing **jettyv2** file. Output goes to
`perf/out/paper`; use `--out /absolute/path` to keep screenshots and HTML elsewhere.
Use `--only 'Area/state'` (substring match) or `--only Foundations` while fixing a capture.
Partial runs merge their results into the same output manifest. Full runs replace the
manifest. Failed states remove their generated artboard and are listed as dropped.

The script clones the perf lab's golden home, writes schema-checked fixture snapshots
while that clone is stopped, then starts the echo server and Vite on free ports. GitHub
runs in replay mode. The project repository is also cloned into the isolated stack.
`replay.ts` rekeys the existing recorded responses for the current GraphQL queries;
it never fetches GitHub or changes the original recordings. Worktree loading uses a
real delayed setup in that cloned repository. Browser input and screenshots go through
`perf/driver.ts`. A
`finally` block closes the browser and stops both owned processes. Never point fixtures
at your normal Jetty home, or run this against the normal development servers.

`views.ts` is the capture registry: add a named area/state, route, readiness condition,
optional UI actions and theme list there. `fixtures.ts` holds states the echo agent cannot
produce. The serializer measures the real DOM, resolves its computed styles and emits
editable text in Geist/Geist Mono plus inline SVG. It uses absolute geometry to preserve
layouts that Paper's flex importer cannot express (grid, tables and scrolled content).
Shadow renderers, canvas, video, unsupported CSS masks and blurred backdrops become
CDP screenshot regions. Gradient masks use small image strips at their fade edges;
the rest of their contents remain layers. Dialog content remains editable above its
raster backdrop. Animated gradient text is a small raster region. Existing image
assets remain images. PR lists run first while their seeded cache is fresh; the lab's
default search replay intentionally returns empty lists.
Raster asset filenames include their content hash because Paper caches local asset paths.

Only `App — <Area>` pages are created or refreshed. Existing generated artboards keep
identity; their generated children are replaced. No file or page is deleted or renamed.
The existing exploration tokens are untouched. Generated Tailwind v4 tokens use the
`app` namespace (`--color-app-background` is dark; `--color-app-light-background` and
`--color-app-oled-background` hold alternatives). Main screens and Foundations have
light/OLED variants; other states are dark. States go left to right; themes go top to bottom.

Each run saves a manifest, self-contained HTML, source screenshots, Paper screenshots
and raster regions. Compare each source/Paper pair before accepting an artboard.
Paper screenshot tool caps large images at 2000px; resize the source comparison to the
returned dimensions before measuring differences.
Fix the serializer or state setup and rerun; do not hand-maintain the imported layers. Dated
design explorations belong on other pages and are never capture targets.
