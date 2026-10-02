import type { Client } from '@jetty/server/src/rpc-test-client'

import type { Page } from './driver'
import type { Fixtures } from './seed'

export type Ctx = {
  page: Page
  origin: string
  fixtures: Fixtures
  rpc: Client
  vars: Record<string, string>
}

export type Journey = {
  // The contract's journey name; its record ends the measurement.
  name: string
  // The fixture it runs on. Several cases per journey give a held-out set for hillclimbing.
  case: string
  // act() loads a new document, so counters start from zero instead of a delta.
  navigates?: boolean
  // Server environment for this journey; servers are shared between journeys with equal env.
  env?: Record<string, string>
  setup(ctx: Ctx): Promise<void>
  act(ctx: Ctx): Promise<void>
  // DOM fallback for "the journey finished" when the page has no record for it.
  done: (ctx: Ctx) => string
  // Extra condition before counters are read (e.g. the streamed turn has completed).
  settled?: (ctx: Ctx) => string
  cleanup?(ctx: Ctx): Promise<void>
}

export const composer = `document.querySelector('textarea[aria-label="Thread prompt"]')`

export function row(title: string) {
  return `[...document.querySelectorAll('.thread-row')].find((row) => row.querySelector('.overflow-title-text')?.textContent === ${JSON.stringify(title)})`
}

export function hasText(text: string) {
  return `!!document.getElementById('root')?.textContent.includes(${JSON.stringify(text)})`
}

export async function waitFor(page: Page, expression: string, what: string, ms = 15_000) {
  const deadline = Date.now() + ms
  for (;;) {
    if (await page.evaluate<boolean>(`!!(${expression})`)) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(50)
  }
}

// Clicks an element's centre with trusted input, then parks the mouse where it hovers nothing,
// so hover cards and tooltips never open on their own timers.
export async function click(page: Page, element: string, what: string) {
  await waitFor(page, element, what)
  const at = await page.evaluate<{ x: number; y: number }>(`(() => {
    const box = (${element}).getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })()`)
  await page.click(at.x, at.y)
  await park(page)
}

export async function park(page: Page) {
  await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1439, y: 899 })
}

// The page is quiet once the lab's mutation count stops moving for `ms`.
export async function quiet(page: Page, ms = 500, timeout = 10_000) {
  const deadline = Date.now() + timeout
  let last = -1
  let since = Date.now()
  for (;;) {
    const now = await page.evaluate<number>('window.__perfLab?.mutations ?? 0')
    if (now !== last) {
      last = now
      since = Date.now()
    } else if (Date.now() - since >= ms) return true
    if (Date.now() > deadline) return false
    await Bun.sleep(50)
  }
}

export async function open(ctx: Ctx, path: string, ready: string) {
  await ctx.page.navigate(`${ctx.origin}${path}`)
  await waitFor(ctx.page, ready, `${path} to load`)
}

export async function newThread(ctx: Ctx) {
  const id = crypto.randomUUID()
  await ctx.rpc.request('thread.create', {
    id,
    projectId: ctx.fixtures.projectId,
    environment: 'local',
  })
  ctx.vars.thread = id
  return id
}

export async function deleteThread(ctx: Ctx) {
  if (ctx.vars.thread) await ctx.rpc.request('thread.delete', { threadId: ctx.vars.thread })
}
