import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { repoRoot } from '../app'
import { openPage, viewport, type Page } from '../driver'
import { waitFor } from '../journey'
import { writeFixtures } from './fixtures'
import { connectPaper, fileId, payload } from './mcp'
import { prepareHome, startStack } from './stack'
import { foundationExpression, iconCatalogExpression, readTokens, type Theme } from './tokens'
import { views, type Context, type View } from './views'

type Info = { pages: { id: string; name: string }[]; artboards: { id: string; name: string }[] }
type Capture = {
  background: string
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
const selected = (
  only ? views.filter((view) => `${view.area}/${view.state}`.includes(only)) : views
).toSorted((a, b) => Number(b.area === 'PR list') - Number(a.area === 'PR list'))
if (only && only !== 'Foundations' && !selected.length) throw new Error('No matching capture state')
mkdirSync(out, { recursive: true })
const paper = await connectPaper()
const info = payload<Info>(await paper.call('get_basic_info', { fileId }))
await paper.call('get_selection', { fileId })
const pages = new Map(info.pages.map((page) => [page.name, page.id]))
const existing = new Map<string, Map<string, string>>()
const prior =
  only && (await Bun.file(join(out, 'manifest.json')).exists())
    ? ((await Bun.file(join(out, 'manifest.json')).json()) as {
        fileId: string
        entries: Entry[]
        dropped: { area: string; state: string; theme: Theme; reason: string }[]
      })
    : undefined
if (prior && prior.fileId !== fileId)
  throw new Error('Output manifest belongs to a different Paper file')
const entries: Entry[] = prior?.entries ?? []
const dropped: { area: string; state: string; theme: Theme; reason: string }[] =
  prior?.dropped ?? []
const prepared = await prepareHome(out)
const ids = writeFixtures(prepared.home, out, prepared.fixtures)
const stack = await startStack(prepared)
const { page, rpc } = await openSession()
const ctx: Context = { page, fixtures: prepared.fixtures, ids, rpc, repo: prepared.repo }
const browserSource = await Bun.file(join(import.meta.dir, 'serialize.js')).text()
const allTokens: { name: string; value: string }[] = []

async function openSession() {
  const page = await openPage().catch(async (error: unknown) => {
    await stack.stop()
    throw error
  })
  try {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: false,
    })
    return { page, rpc: await stack.server.connect() }
  } catch (error) {
    try {
      await page.close()
    } finally {
      await stack.stop()
    }
    throw error
  }
}

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

async function dropBoard(area: string, state: string, theme: Theme) {
  const pageId = pages.get(`App — ${area}`)
  if (!pageId) return
  const info = payload<Info>(await paper.call('get_basic_info', { fileId, pageId }))
  const name = `${area} / ${state}${theme === 'dark' ? '' : ` (${theme})`}`
  const board = info.artboards.find((board) => board.name === name)
  if (board) await paper.call('delete_nodes', { fileId, nodeIds: [board.id] })
  const index = entries.findIndex(
    (entry) => entry.area === area && entry.state === state && entry.theme === theme
  )
  if (index >= 0) entries.splice(index, 1)
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
    left: `${column * ({ Sidebar: 330, Composer: 788, 'Details pane': 800, 'Files & editor': 800, Foundations: 1180 }[area] ?? 1520)}px`,
    top: `${row * 1500}px`,
    overflow: 'hidden',
    backgroundColor: capture.background,
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
  const priorIndex = entries.findIndex(
    (entry) => entry.area === area && entry.state === state && entry.theme === theme
  )
  if (priorIndex >= 0) entries.splice(priorIndex, 1)
  const droppedIndex = dropped.findIndex(
    (entry) => entry.area === area && entry.state === state && entry.theme === theme
  )
  if (droppedIndex >= 0) dropped.splice(droppedIndex, 1)
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
    source: `localStorage.clear();localStorage.setItem('jetty.theme',${JSON.stringify(theme)});localStorage.setItem('jetty.details-tabs',JSON.stringify({order:['overview','changes','files','threads'],closed:['files']}));`,
  })
  await page.navigate(`${stack.origin}${view.route(ctx)}`)
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier })
  await waitFor(page, view.ready ?? `document.querySelector('main')`, 'view ready', 30_000)
  await page.evaluate('document.fonts.ready')
  await Bun.sleep(view.settleMs ?? 350)
  await view.setup?.(ctx)
  await page.evaluate(
    `document.querySelector('[data-perf-region="composer"]')?.parentElement.setAttribute('data-paper-composer-shell','')`
  )
  await Bun.sleep(view.settleMs ?? 250)
  if (view.verify) await waitFor(page, view.verify, 'state verification')
}

try {
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
        await dropBoard(view.area, view.state, theme)
        await screenshot(
          page,
          join(
            out,
            `dropped-${view.area}-${view.state}-${theme}.png`.replace(/[^a-zA-Z0-9/.-]/g, '-')
          )
        ).catch(() => undefined)
        await Bun.write(
          join(out, `dropped-${view.area}-${view.state}-${theme}.txt`),
          await page.evaluate<string>('document.body.innerText')
        ).catch(() => undefined)
        dropped.push({ area: view.area, state: view.state, theme, reason })
        await saveManifest()
        console.error(`DROPPED ${view.area}/${view.state}/${theme}: ${reason}`)
      } finally {
        await view.cleanup?.(ctx)
      }
    }
  }
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
  if (!only || only === 'Foundations') {
    await navigate(views[0]!, 'dark')
    const tokens = await readTokens(page, 'dark')
    const height = await page.evaluate<number>(iconCatalogExpression())
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await writeCapture(
      'Foundations',
      'icon catalog',
      'dark',
      '#paper-icon-catalog',
      tokens.references,
      1
    )
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }
  if (allTokens.length)
    await Bun.write(
      join(out, 'tokens.css'),
      `@theme {\n${allTokens.map((token) => `  ${token.name}: ${token.value};`).join('\n')}\n}\n`
    )
} finally {
  await paper.call('finish_working_on_nodes', { fileId }).catch(() => undefined)
  try {
    await Promise.allSettled([rpc.close(), page.close()])
  } finally {
    await stack.stop()
    await saveManifest()
  }
}
console.log(
  `Capture complete: ${entries.length} artboards; ${dropped.length} dropped. ${out}/manifest.json`
)
