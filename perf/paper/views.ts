import type { Page } from '../driver'
import type { Fixtures } from '../seed'
import type { Theme } from './tokens'

import { click, waitFor } from '../journey'

export type Context = { page: Page; fixtures: Fixtures; ids: Record<string, string> }
export type View = {
  area: string
  state: string
  route: (ctx: Context) => string
  selector?: string
  themes?: Theme[]
  ready?: string
  setup?: (ctx: Context) => Promise<void>
}

const main = 'main'
const allThemes: Theme[] = ['dark', 'light', 'oled']
const prompt = `document.querySelector('textarea[aria-label="Thread prompt"]')`
const text = (value: string) =>
  `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(value)})`
export const button = (label: string) =>
  `document.querySelector('button[aria-label=${JSON.stringify(label)}]')`

async function details(ctx: Context) {
  await click(ctx.page, button('Open thread details'), 'details toggle')
  await waitFor(
    ctx.page,
    `document.querySelector('[aria-label="Thread details"]').getBoundingClientRect().width > 300`,
    'details pane'
  )
}

function thread(state: string): View {
  return {
    area: 'Thread chat',
    state,
    route: (ctx) => `/threads/${ctx.ids[state]}`,
    selector: main,
    ready: prompt,
  }
}

export const views: View[] = [
  {
    area: 'Sidebar',
    state: 'thread list',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[data-perf-region="sidebar"]',
    themes: allThemes,
    ready: prompt,
  },
  {
    area: 'Sidebar',
    state: 'row hover',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[data-perf-region="sidebar"]',
    ready: prompt,
    async setup({ page }) {
      const at = await page.evaluate<{ x: number; y: number }>(
        `(()=>{const r=[...document.querySelectorAll('.thread-row')].find(e=>e.textContent.includes('small')).getBoundingClientRect();return {x:r.x+80,y:r.y+20}})()`
      )
      await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    },
  },
  {
    area: 'Sidebar',
    state: 'search empty',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[data-perf-region="sidebar"]',
    ready: prompt,
    async setup({ page }) {
      await click(page, `document.querySelector('[aria-label="Search threads"]')`, 'thread search')
      await page.cdp('Input.insertText', { text: 'no matching thread' })
    },
  },
  {
    area: 'Thread chat',
    state: 'conversation',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: main,
    themes: allThemes,
    ready: prompt,
  },
  ...['empty', 'approval', 'question', 'error', 'restart', 'queue', 'watcher', 'plan', 'tools'].map(
    thread
  ),
  {
    area: 'Composer',
    state: 'empty',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[data-perf-region="composer"]',
    ready: prompt,
  },
  {
    area: 'Composer',
    state: 'draft',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[data-perf-region="composer"]',
    ready: prompt,
    async setup({ page }) {
      await click(page, prompt, 'prompt')
      await page.cdp('Input.insertText', {
        text: 'Check the cache invalidation and summarize the changes.',
      })
    },
  },
  {
    area: 'Details pane',
    state: 'overview',
    route: (ctx) => `/threads/${ctx.fixtures.threads.diff}`,
    selector: '[aria-label="Thread details"]',
    ready: prompt,
    setup: details,
  },
  {
    area: 'Details pane',
    state: 'changes empty',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[aria-label="Thread details"]',
    ready: prompt,
    async setup(ctx) {
      await details(ctx)
      await click(ctx.page, text('Changes'), 'Changes tab')
    },
  },
  {
    area: 'PR view',
    state: 'open',
    route: () => '/pull-requests/jettpbaker/pr-lab/1',
    selector: main,
    themes: allThemes,
    ready: `document.body.textContent.includes('Add discount codes')`,
  },
  {
    area: 'PR view',
    state: 'draft',
    route: () => '/pull-requests/jettpbaker/pr-lab/2',
    selector: main,
    ready: `document.body.textContent.includes('Activity')`,
  },
  {
    area: 'PR view',
    state: 'merged',
    route: () => '/pull-requests/jettpbaker/pr-lab/3',
    selector: main,
    ready: `document.body.textContent.includes('Activity')`,
  },
  {
    area: 'PR view',
    state: 'closed',
    route: () => '/pull-requests/jettpbaker/pr-lab/4',
    selector: main,
    ready: `document.body.textContent.includes('Activity')`,
  },
  {
    area: 'PR list',
    state: 'repository',
    route: () => '/pull-requests',
    selector: main,
    ready: `document.body.textContent.includes('Pull requests')`,
  },
  {
    area: 'Files & editor',
    state: 'file tree',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[aria-label="Thread details"]',
    ready: prompt,
    async setup(ctx) {
      await details(ctx)
      await click(ctx.page, button('Open tab'), 'tab menu')
      await click(
        ctx.page,
        `[...document.querySelectorAll('[role="menuitemcheckbox"],[role="menuitem"]')].find(e=>e.textContent.includes('Files'))`,
        'Files menu item'
      )
      await click(ctx.page, text('Files'), 'Files tab')
    },
  },
  {
    area: 'Settings',
    state: 'providers and loadout',
    route: () => '/settings',
    selector: main,
    themes: allThemes,
    ready: `document.querySelector('#providers')`,
  },
  ...['agent-behaviour', 'integrations', 'worktrees', 'projects', 'appearance'].map(
    (section): View => ({
      area: 'Settings',
      state: section,
      route: () => '/settings',
      selector: main,
      ready: `document.querySelector('#${section}')`,
      async setup({ page }) {
        await page.evaluate(`document.querySelector('#${section}').scrollIntoView({block:'start'})`)
      },
    })
  ),
  {
    area: 'Usage',
    state: 'accounts',
    route: () => '/usage',
    selector: main,
    ready: `document.body.textContent.includes('Usage')`,
  },
  {
    area: 'New thread',
    state: 'worktree setup needed',
    route: () => '/',
    selector: main,
    ready: prompt,
  },
  ...[
    ['thread actions', 'Actions for small'],
    ['thread grouping', 'Thread grouping: Date'],
    ['model loadout', 'Loadout: Opus, High'],
    ['access mode', 'Access mode: Auto'],
    ['attachments', 'Add attachment'],
    ['context window', 'Context window 26% full'],
  ].map(
    ([state, label]): View => ({
      area: 'Overlays',
      state: state!,
      route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
      selector: 'body',
      ready: prompt,
      async setup({ page }) {
        await click(page, button(label!), 'overlay trigger')
      },
    })
  ),
]
