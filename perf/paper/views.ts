import type { Client } from '@jetty/server/src/rpc-test-client'

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { Page } from '../driver'
import type { Fixtures } from '../seed'
import type { Theme } from './tokens'

import { click as clickElement, waitFor } from '../journey'

export type Context = {
  page: Page
  fixtures: Fixtures
  ids: Record<string, string>
  rpc: Client
  repo: string
}
export type View = {
  area: string
  state: string
  route: (ctx: Context) => string
  selector?: string
  themes?: Theme[]
  ready?: string
  setup?: (ctx: Context) => Promise<void>
  verify?: string
  settleMs?: number
  cleanup?: (ctx: Context) => Promise<void>
}

async function click(page: Page, element: string, what: string) {
  await waitFor(page, element, what)
  await page.evaluate(`(${element}).scrollIntoView({block:'nearest',inline:'nearest'})`)
  await clickElement(page, element, what)
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
  await click(ctx.page, text('Overview'), 'Overview tab')
}

async function files(ctx: Context) {
  await details(ctx)
  await click(ctx.page, button('Open tab'), 'tab menu')
  await click(
    ctx.page,
    `[...document.querySelectorAll('[role="menuitemcheckbox"],[role="menuitem"]')].find(e=>e.textContent.includes('Files'))`,
    'Files menu item'
  )
  await ctx.page.key('Escape')
  await click(ctx.page, text('Files'), 'Files tab')
  await waitFor(
    ctx.page,
    `[...document.querySelectorAll('*')].some(e=>e.shadowRoot?.querySelector('[data-item-path]'))`,
    'file tree'
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
      await page.evaluate(
        `[...document.querySelectorAll('.thread-row')].find(e=>e.textContent.includes('small')).scrollIntoView({block:'nearest'})`
      )
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
    area: 'Thread chat',
    state: 'streaming',
    route: (ctx) => `/threads/${ctx.ids.streaming}`,
    selector: main,
    ready: prompt,
    async setup(ctx) {
      const threadId = ctx.ids.streaming!
      const sub = ctx.rpc.subscribeThread({ threadId })
      await sub.ready
      await ctx.rpc.request('turn.start', {
        threadId,
        text: 'Explain how the thread cache keeps switching instant. '.repeat(12),
        provider: 'claude',
      })
      await sub.waitFor(
        (message) =>
          message.type === 'event' &&
          message.event.type === 'item.started' &&
          message.event.item.kind === 'assistant_message',
        30_000
      )
      await sub.cancel()
      await waitFor(ctx.page, button('Stop'), 'streaming stop control')
      await Bun.sleep(600)
    },
    async cleanup(ctx) {
      await ctx.rpc.request('turn.interrupt', { threadId: ctx.ids.streaming! })
    },
  },
  ...['pending', 'ready', 'failed', 'stopped'].map(
    (state): View => ({
      area: 'Composer',
      state: `worktree ${state}`,
      route: (ctx) => `/threads/${ctx.ids[`worktree ${state}`]}`,
      selector: '[data-paper-composer-shell]',
      ready: prompt,
    })
  ),
  {
    area: 'Thread chat',
    state: 'loading worktree setup',
    route: (ctx) => `/threads/${ctx.ids['worktree setting_up']}`,
    selector: main,
    ready: prompt,
    async setup(ctx) {
      await mkdir(join(ctx.repo, '.jetty'), { recursive: true })
      await Bun.write(join(ctx.repo, '.jetty/worktree.json'), JSON.stringify({ setup: 'sleep 30' }))
      const chrome = ctx.rpc.subscribeChrome()
      await chrome.ready
      void ctx.rpc
        .request('turn.start', {
          threadId: ctx.ids['worktree setting_up']!,
          text: 'Check the worktree once setup finishes.',
          provider: 'claude',
        })
        .catch((error) => console.warn('Interrupted capture setup:', String(error)))
      await chrome.waitFor(
        (message) =>
          message.type === 'thread.upserted' &&
          message.thread.id === ctx.ids['worktree setting_up'] &&
          message.thread.worktree?.state === 'setting_up',
        15000
      )
      await chrome.cancel()
      await waitFor(
        ctx.page,
        `document.body.textContent.includes('Queued')`,
        'queued message during setup'
      )
    },
    async cleanup(ctx) {
      await ctx.rpc.request('turn.interrupt', { threadId: ctx.ids['worktree setting_up']! })
      await rm(join(ctx.repo, '.jetty/worktree.json'), { force: true })
    },
  },
  {
    area: 'Composer',
    state: 'empty',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[data-paper-composer-shell]',
    ready: prompt,
  },
  {
    area: 'Composer',
    state: 'draft',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[data-paper-composer-shell]',
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
    route: () => '/pull-requests/jettpbaker/pr-lab/3',
    selector: main,
    ready: `document.body.textContent.includes('Activity')`,
  },
  {
    area: 'PR view',
    state: 'merged',
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
    area: 'PR view',
    state: 'diff',
    route: () => '/pull-requests/jettpbaker/pr-lab/1',
    selector: main,
    ready: `document.body.textContent.includes('Activity')`,
    async setup({ page }) {
      await click(
        page,
        `[...document.querySelectorAll('nav[aria-label="Pull request view"] button')].find(e=>e.textContent.trim()==='Diff')`,
        'Diff tab'
      )
      await waitFor(
        page,
        `[...document.querySelectorAll('diffs-container')].some(e=>e.shadowRoot?.querySelector('pre'))`,
        'Pierre diff'
      )
    },
  },
  {
    area: 'PR view',
    state: 'unavailable',
    route: () => '/pull-requests/jettpbaker/pr-lab/999',
    selector: main,
    ready: `document.body.textContent.includes('GitHub unavailable')`,
  },
  {
    area: 'Files & editor',
    state: 'file tree',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[aria-label="Thread details"]',
    ready: prompt,
    setup: files,
  },
  {
    area: 'Files & editor',
    state: 'editor',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[aria-label="Thread details"]',
    ready: prompt,
    async setup(ctx) {
      await files(ctx)
      await click(
        ctx.page,
        `[...document.querySelectorAll('*')].flatMap(e=>[...e.shadowRoot?.querySelectorAll('[data-item-path]') ?? []]).find(e=>e.getAttribute('data-item-path')==='README.md')`,
        'README file'
      )
      await waitFor(
        ctx.page,
        `[...document.querySelectorAll('diffs-container')].some(e=>e.shadowRoot?.querySelector('pre'))`,
        'Pierre editor'
      )
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
      selector: `#${section}`,
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
      verify: `[...document.querySelectorAll('[data-slot=dropdown-menu-content],[data-slot=popover-content],[role=menu]')].some(e=>e.getBoundingClientRect().width>0)`,
      async setup({ page }) {
        await click(page, button(label!), 'overlay trigger')
      },
    })
  ),
]

views.push(
  {
    area: 'Overlays',
    state: 'link pull request dialog',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: 'body',
    ready: prompt,
    async setup(ctx) {
      await details(ctx)
      await click(ctx.page, button('Open tab'), 'tab menu')
      await click(
        ctx.page,
        `[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('Link pull request'))`,
        'Link pull request'
      )
      await waitFor(
        ctx.page,
        `document.querySelector('[aria-label="Pull request URL or number"]')`,
        'link dialog'
      )
    },
  },
  {
    area: 'Overlays',
    state: 'slash command palette',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: 'body',
    ready: prompt,
    async setup({ page }) {
      await click(page, prompt, 'prompt')
      await page.evaluate(`(${prompt}).select()`)
      await page.cdp('Input.insertText', { text: '/' })
      await page.key('ArrowRight')
      await waitFor(
        page,
        `document.querySelector('[aria-label="Slash commands"]')`,
        'slash command palette'
      )
    },
  },
  {
    area: 'Overlays',
    state: 'archive undo toast',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: 'body',
    ready: prompt,
    async setup({ page }) {
      await click(page, button('Archive Capture · toast'), 'archive fixture thread')
      await waitFor(page, `document.querySelector('[data-sonner-toast]')`, 'undo toast')
    },
  },
  {
    area: 'Overlays',
    state: 'disabled issue tooltip',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: 'body',
    ready: prompt,
    async setup({ page }) {
      const at = await page.evaluate<{ x: number; y: number }>(
        `(()=>{const e=[...document.querySelectorAll('nav[aria-label="Main navigation"] button')].find(e=>e.textContent.includes('Issues'));const r=e.getBoundingClientRect();return {x:r.x+40,y:r.y+r.height/2}})()`
      )
      await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
      await waitFor(
        page,
        `document.querySelector('[data-slot="tooltip-content"]')`,
        'disabled issue tooltip'
      )
    },
  }
)

views.push(
  {
    area: 'Details pane',
    state: 'plan overview',
    route: (ctx) => `/threads/${ctx.ids.plan}`,
    selector: '[aria-label="Thread details"]',
    ready: prompt,
    setup: details,
  },
  {
    area: 'Thread chat',
    state: 'work expanded',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: main,
    ready: prompt,
    async setup({ page }) {
      await click(
        page,
        `[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Worked'))`,
        'work activity'
      )
      await click(page, `document.querySelector('[aria-label="Called Hello there"]')`, 'tool call')
    },
  },
  {
    area: 'PR list',
    state: 'created empty',
    route: () => '/pull-requests?tab=created',
    selector: main,
    ready: `document.body.textContent.includes('No pull requests')`,
  }
)
