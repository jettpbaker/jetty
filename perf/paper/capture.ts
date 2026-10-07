import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { repoRoot } from '../app'
import { openPage, viewport, type Page } from '../driver'
import { waitFor } from '../journey'
import { writeFixtures } from './fixtures'
import { connectPaper, fileId, payload } from './mcp'
import { prepareHome, startStack } from './stack'
import { foundationExpression, readTokens, type Theme } from './tokens'
import { views, type Context, type View } from './views'

type Info = { pages: { id: string; name: string }[]; artboards: { id: string; name: string }[] }
type Capture = {
  html: string
  images: {
    key: string
    name: string
    reason: string
    x: number
    y: number
    width: number
    height: number
  }[]
  width: number
  height: number
}
type Entry = {
  area: string
  state: string
  theme: Theme
  pageId: string
  artboardId: string
  source: string
  paper: string
  images: Capture['images']
  width: number
  height: number
}

const args = process.argv.slice(2)
function option(name: string) {
  const at = args.indexOf(name)
  return at < 0 ? undefined : args[at + 1]
}
const out = resolve(option('--out') ?? join(repoRoot, 'perf/out/paper'))
const only = option('--only')
const selected = only ? views.filter((view) => `${view.area}/${view.state}`.includes(only)) : views
mkdirSync(out, { recursive: true })
const paper = await connectPaper()
const info = payload<Info>(await paper.call('get_basic_info', { fileId }))
await paper.call('get_selection', { fileId })
const pages = new Map(info.pages.map((page) => [page.name, page.id]))
const existing = new Map<string, Map<string, string>>()
const entries: Entry[] = []
const dropped: { area: string; state: string; theme: Theme; reason: string }[] = []
const prepared = await prepareHome(out)
const ids = writeFixtures(prepared.home, out, prepared.fixtures)
const stack = await startStack(prepared)
const page = await openPage()
await page.cdp('Emulation.setDeviceMetricsOverride', {
  ...viewport,
  deviceScaleFactor: 1,
  mobile: false,
})
const ctx: Context = { page, fixtures: prepared.fixtures, ids }
const browserSource = await Bun.file(join(import.meta.dir, 'serialize.js')).text()
const allTokens: { name: string; value: string }[] = []

async function pageFor(area: string) {
  const name = `App — ${area}`
  let id = pages.get(name)
  if (!id) {
    const result = await paper.call('create_page', { fileId, name })
    const created = payload<{ id?: string; pageId?: string; page?: { id: string } }>(result)
    id = created.pageId ?? created.id ?? created.page?.id
    if (!id) throw new Error(`Missing page id: ${JSON.stringify(result)}`)
    pages.set(name, id)
  }
  if (!existing.has(id)) {
    const result = payload<Info>(await paper.call('get_basic_info', { fileId, pageId: id }))
    existing.set(id, new Map(result.artboards.map((board) => [board.name, board.id])))
  }
  return id
}

async function screenshot(page: Page, path: string, clip?: Record<string, unknown>) {
  const result = await page.cdp<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    ...(clip && { clip: { ...clip, scale: 1 } }),
    captureBeyondViewport: false,
  })
  await Bun.write(path, Buffer.from(result.data, 'base64'))
}

async function writeCapture(
  area: string,
  state: string,
  theme: Theme,
  selector: string,
  references: Record<string, string>,
  column: number
) {
  await page.evaluate(browserSource)
  const capture = await page.evaluate<Capture>(
    `window.__paperCapture(${JSON.stringify(selector)},${JSON.stringify(references)})`
  )
  if (!capture.html || !capture.width || !capture.height) throw new Error('Capture is empty')
  const slug = `${area}-${state}-${theme}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const source = join(out, `${slug}.app.png`)
  const origin = await page.evaluate<{ x: number; y: number }>(
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:${selector === 'body' ? '0' : 'r.x'},y:${selector === 'body' ? '0' : 'r.y'}}})()`
  )
  await screenshot(page, source, { ...origin, width: capture.width, height: capture.height })
  for (const [index, image] of capture.images.entries()) {
    const path = join(out, `${slug}.image-${index}.png`)
    const { x, y, width, height } = image
    await screenshot(page, path, { x, y, width, height })
    capture.html = capture.html.replace(image.key, `paper-asset://${path}`)
  }
  await Bun.write(join(out, `${slug}.html`), capture.html)
  const pageId = await pageFor(area)
  const boards = existing.get(pageId)!
  const name = `${area} / ${state}${theme === 'dark' ? '' : ` (${theme})`}`
  let artboardId = boards.get(name)
  const row = ['dark', 'light', 'oled'].indexOf(theme)
  const styles = {
    width: `${capture.width}px`,
    height: `${capture.height}px`,
    left: `${column * (capture.width + 80)}px`,
    top: `${row * 1500}px`,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  }
  if (artboardId) {
    await paper.call('update_styles', { fileId, updates: [{ nodeIds: [artboardId], styles }] })
    const children = payload<{ children: { id: string }[] }>(
      await paper.call('get_children', { fileId, nodeId: artboardId })
    ).children
    if (children.length)
      await paper.call('delete_nodes', { fileId, nodeIds: children.map((child) => child.id) })
  } else {
    const result = await paper.call('create_artboard', { fileId, pageId, name, styles })
    const board = payload<{ id?: string; nodeId?: string; artboard?: { id: string } }>(result)
    artboardId = board.id ?? board.nodeId ?? board.artboard?.id
    if (!artboardId) throw new Error(`Missing artboard id: ${JSON.stringify(result)}`)
    boards.set(name, artboardId)
  }
  await paper.call('update_styles', { fileId, updates: [{ nodeIds: [artboardId], styles }] })
  await paper.call('write_html', {
    fileId,
    targetNodeId: artboardId,
    mode: 'insert-children',
    html: capture.html,
  })
  const result = await paper.call('get_screenshot', { fileId, nodeId: artboardId, scale: 1 })
  const png = result.content.find((content) => content.type === 'image')
  if (!png?.data) throw new Error('Paper screenshot missing')
  const paperShot = join(out, `${slug}.paper.png`)
  await Bun.write(paperShot, Buffer.from(png.data, 'base64'))
  entries.push({
    area,
    state,
    theme,
    pageId,
    artboardId,
    source,
    paper: paperShot,
    images: capture.images,
    width: capture.width,
    height: capture.height,
  })
  await paper.call('finish_working_on_nodes', { fileId, nodeIds: [artboardId] })
  await saveManifest()
  console.log(`CAPTURED ${area} / ${state} / ${theme} (${capture.images.length} image regions)`)
}

async function saveManifest() {
  await Bun.write(
    join(out, 'manifest.json'),
    JSON.stringify({ fileId, origin: stack.origin, home: prepared.home, entries, dropped }, null, 2)
  )
}

async function navigate(view: View, theme: Theme) {
  const script = await page.cdp<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.clear();localStorage.setItem('jetty.theme',${JSON.stringify(theme)});localStorage.setItem('jetty.details-tabs',JSON.stringify({order:['overview','changes','files','threads'],closed:[]}));`,
  })
  await page.navigate(`${stack.origin}${view.route(ctx)}`)
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier })
  await waitFor(page, view.ready ?? `document.querySelector('main')`, 'view ready', 30_000)
  await page.evaluate('document.fonts.ready')
  await Bun.sleep(350)
  await view.setup?.(ctx)
  await Bun.sleep(250)
}

try {
  if (!only || only === 'Foundations') {
    for (const theme of ['dark', 'light', 'oled'] as const) {
      await navigate(views[0]!, theme)
      const tokens = await readTokens(page, theme)
      allTokens.push(...tokens.tokens)
      await paper.syncTokens(tokens.tokens)
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width: 1100,
        height: 1320,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await page.evaluate(foundationExpression(theme, tokens.colors))
      await writeCapture(
        'Foundations',
        'tokens, type, radii and icons',
        theme,
        '#paper-foundations',
        tokens.references,
        0
      )
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        ...viewport,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
  }
  for (const view of selected) {
    const column = views.filter((candidate) => candidate.area === view.area).indexOf(view)
    for (const theme of view.themes ?? ['dark']) {
      try {
        await navigate(view, theme)
        const tokens = await readTokens(page, theme)
        await paper.syncTokens(tokens.tokens)
        await writeCapture(
          view.area,
          view.state,
          theme,
          view.selector ?? 'body',
          tokens.references,
          column
        )
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        dropped.push({ area: view.area, state: view.state, theme, reason })
        await saveManifest()
        console.error(`DROPPED ${view.area}/${view.state}/${theme}: ${reason}`)
      }
    }
  }
  if (allTokens.length)
    await Bun.write(
      join(out, 'tokens.css'),
      `@theme {\n${allTokens.map((token) => `  ${token.name}: ${token.value};`).join('\n')}\n}\n`
    )
} finally {
  await paper.call('finish_working_on_nodes', { fileId }).catch(() => undefined)
  await page.close()
  await stack.stop()
  await saveManifest()
}
console.log(
  `Capture complete: ${entries.length} artboards; ${dropped.length} dropped. ${out}/manifest.json`
)
