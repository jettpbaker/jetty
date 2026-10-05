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
  optIn?: boolean
  domOnly?: boolean
  metrics?(ctx: Ctx): Promise<Record<string, number>>
  // act() loads a new document, so counters start from zero instead of a delta.
  navigates?: boolean
  // Server environment for this journey; servers are shared between journeys with equal env.
  env?: Record<string, string>
  setup(ctx: Ctx): Promise<void>
  act(ctx: Ctx): Promise<void>
  // DOM fallback for "the journey finished" when the page has no record for it. It's polled
  // inside the measured window, so it must not call app code: use native getters, since
  // React wraps input values.
  done: (ctx: Ctx) => string
  // Extra condition before counters are read (e.g. the streamed turn has completed).
  settled?: (ctx: Ctx) => string
  cleanup?(ctx: Ctx): Promise<void>
}

export const composer = `document.querySelector('textarea[aria-label="Thread prompt"]')`

// The new-thread page's branch picker names its ref once the full branch list lands, which waits
// on git: a journey on that page waits for it, or the list's render races the counted window.
export const branchPicked = `document.querySelector('[aria-label^="From: "]')`

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

// The page is quiet once it goes `ms` without a DOM mutation and has no idle callback waiting.
// The wait runs in the page: polling from here keeps waking it, which holds back idle callbacks.
export function quiet(page: Page, ms = 500, timeout = 10_000) {
  return page.evaluate<boolean>(`window.__perfLab.quiet(${ms}, ${Math.max(0, timeout)})`)
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
