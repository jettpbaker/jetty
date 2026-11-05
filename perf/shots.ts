// Screenshots of every state in paper/views.ts on the lab's seeded stack, without Paper or a dock
// tile: chrome-headless-shell, retina, one full window per state plus a crop of the region it's about.
// usage: bun perf/shots.ts [--out dir] [--only 'Area/state'] [--themes dark,light,oled]
import { Glob } from 'bun'
import { mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { Theme } from './paper/tokens'

import { repoRoot } from './app'
import { openPage, viewport, type Page } from './driver'
import { writeFixtures } from './paper/fixtures'
import { prepareHome, startStack } from './paper/stack'
import { openView, views, type Context } from './paper/views'

const args = process.argv.slice(2)
function option(name: string) {
  const at = args.indexOf(name)
  return at < 0 ? undefined : args[at + 1]
}

function headlessShell() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  const glob = new Glob(
    'chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell'
  )
  const found = [...glob.scanSync({ cwd: cache, onlyFiles: true })].toSorted().at(-1)
  if (!found) throw new Error('Install it with: bunx playwright install chromium-headless-shell')
  return join(cache, found)
}

async function shoot(page: Page, path: string, selector?: string) {
  const clip =
    selector &&
    (await page.evaluate<{ x: number; y: number; width: number; height: number } | null>(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`
    ))
  const { data } = await page.cdp<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    ...(clip && { clip: { ...clip, scale: 1 } }),
  })
  await Bun.write(path, Buffer.from(data, 'base64'))
}

const out = resolve(option('--out') ?? join(repoRoot, 'perf/out/shots'))
const only = option('--only')
const themes = option('--themes')?.split(',') as Theme[] | undefined
const selected = (
  only ? views.filter((view) => `${view.area}/${view.state}`.includes(only)) : views
).toSorted((a, b) => Number(b.area === 'PR list') - Number(a.area === 'PR list'))
mkdirSync(out, { recursive: true })

const prepared = await prepareHome(out)
const ids = writeFixtures(prepared.home, out, prepared.fixtures)
const stack = await startStack(prepared)
const page = await openPage(headlessShell())
await page.cdp('Emulation.setDeviceMetricsOverride', {
  ...viewport,
  deviceScaleFactor: 2,
  mobile: false,
})
const rpc = await stack.server.connect()
const ctx: Context = { page, fixtures: prepared.fixtures, ids, rpc, repo: prepared.repo }
const entries: { area: string; state: string; theme: Theme; file: string; crop?: string }[] = []
const dropped: { area: string; state: string; theme: Theme; reason: string }[] = []

try {
  for (const view of selected) {
    for (const theme of themes ?? view.themes ?? ['dark']) {
      const slug = `${view.area}-${view.state}-${theme}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      try {
        await openView(ctx, stack.origin, view, theme)
        const file = `${slug}.png`
        await shoot(page, join(out, file))
        const partial = view.selector && view.selector !== 'body' && view.selector !== 'main'
        const crop = partial ? `${slug}.crop.png` : undefined
        if (crop) await shoot(page, join(out, crop), view.selector)
        entries.push({ area: view.area, state: view.state, theme, file, crop })
        console.log(`SHOT ${slug}`)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        dropped.push({ area: view.area, state: view.state, theme, reason })
        console.error(`DROPPED ${slug}: ${reason}`)
      } finally {
        await view.cleanup?.(ctx)
      }
    }
  }
} finally {
  await Promise.allSettled([rpc.close(), page.close()])
  await stack.stop()
  rmSync(prepared.dir, { recursive: true, force: true })
  await Bun.write(join(out, 'manifest.json'), JSON.stringify({ entries, dropped }, null, 2))
}
console.log(`${entries.length} shots, ${dropped.length} dropped: ${out}/manifest.json`)
