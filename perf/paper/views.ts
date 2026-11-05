import type { Client } from '@jetty/server/src/rpc-test-client'

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { Page } from '../driver'
import type { Fixtures } from '../seed'
import type { Theme } from './tokens'

import { click as clickElement, row as threadRow, waitFor } from '../journey'
import { checkoutPrompt, checkoutTitle } from './fixtures'

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
const treeItem = (path: string) =>
  `[...document.querySelectorAll('*')].flatMap(e=>[...e.shadowRoot?.querySelectorAll('[data-item-path]') ?? []]).find(e=>e.getBoundingClientRect().width>0&&e.getAttribute('data-item-path').replace(new RegExp('/$'),'')===${JSON.stringify(path)})`

async function details(ctx: Context) {
  await click(ctx.page, button('Open thread details'), 'details toggle')
  await waitFor(
    ctx.page,
    `document.querySelector('[aria-label="Thread details"]').getBoundingClientRect().width > 300`,
    'details pane'
  )
  await click(ctx.page, text('Overview'), 'Overview tab')
}

async function conversation({ page }: Pick<Context, 'page'>) {
  await waitFor(
    page,
    `document.querySelector('[aria-label="Conversation"]')`,
    'conversation scrollport'
  )
  await page.evaluate(`document.querySelector('[aria-label="Conversation"]').focus()`)
  await page.key('Home')
  await page.evaluate(`document.querySelector('[aria-label="Conversation"]').blur()`)
}

async function expandedWork(ctx: Context) {
  const { page } = ctx
  await conversation(ctx)
  await click(
    page,
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Worked'))`,
    'work activity'
  )
  await Bun.sleep(400)
  await click(
    page,
    `[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Run the checkout regression tests'))`,
    'checkout tests'
  )
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
  for (const path of ['docs', 'src', 'src/checkout', 'src/discounts'])
    await click(ctx.page, treeItem(path), `${path} folder`)
}

function thread(state: string): View {
  return {
    area: 'Thread chat',
    state,
    route: (ctx) => `/threads/${ctx.ids[state]}`,
    selector: main,
    ready: prompt,
    setup: state === 'tools' ? expandedWork : undefined,
  }
}

export async function openView(ctx: Context, origin: string, view: View, theme: Theme) {
  const { page } = ctx
  const script = await page.cdp<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.clear();localStorage.setItem('jetty.theme',${JSON.stringify(theme)});localStorage.setItem('jetty.loadout',JSON.stringify(Array.from({length:5},(_,index)=>({id:'slot-'+(index+1),provider:'claude',model:index===0?'opus':null,effort:'high',fast:false}))));localStorage.setItem('jetty.details-tabs',JSON.stringify({order:['overview','changes','files','threads'],closed:['files']}));`,
  })
  await page.navigate(`${origin}${view.route(ctx)}`)
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
      await page.evaluate(`(${threadRow(checkoutTitle)}).scrollIntoView({block:'nearest'})`)
      const at = await page.evaluate<{ x: number; y: number }>(
        `(()=>{const r=(${threadRow(checkoutTitle)}).getBoundingClientRect();return {x:r.x+80,y:r.y+r.height/2}})()`
      )
      await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    },
  },
  {
    area: 'Sidebar',
    state: 'bot threads',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[data-perf-region="sidebar"]',
    themes: allThemes,
    ready: prompt,
    async setup({ page }) {
      const toggle = `document.querySelector('[aria-label="Bots"] button[aria-expanded]')`
      if (await page.evaluate(`(${toggle}).getAttribute('aria-expanded') !== 'true'`))
        await click(page, toggle, 'bot threads')
      await waitFor(page, `document.querySelector('[aria-label="Bots"] .thread-row')`, 'bot thread')
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
    setup: conversation,
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
    ready: button('Stop'),
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
      await click(ctx.page, prompt, 'express checkout prompt')
      await ctx.page.cdp('Input.insertText', {
        text: 'Add express checkout without losing the shipping address or discount code. Run the existing checkout tests first.',
      })
      await ctx.page.key('Enter')
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
        `document.body.textContent.includes('Setting up worktree')`,
        'worktree setup progress'
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
        text: 'Add a regression for SAVE15 when the customer switches from AUD to EUR. Keep the code only if it is valid in the new currency.',
      })
    },
    async cleanup({ page }) {
      await click(page, prompt, 'draft prompt')
      await page.evaluate(`(${prompt}).select()`)
      await page.key('Backspace')
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
    route: (ctx) => `/threads/${ctx.fixtures.threads.long}`,
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
    ready: `document.body.textContent.includes('Checkout discount codes')`,
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
      await click(ctx.page, treeItem('docs/checkout.md'), 'checkout guide')
      await waitFor(
        ctx.page,
        `[...document.querySelectorAll('[aria-label="Thread details"] diffs-container')].some(e=>e.getBoundingClientRect().width>0&&e.shadowRoot?.querySelector('pre')?.textContent.includes('Acme Storefront'))`,
        'Pierre editor'
      )
    },
  },
  ...[
    'preferences',
    'appearance',
    'keyboard',
    'notifications',
    'connected-accounts',
    'models',
    'intelligence',
    'guided-reviews',
    'bots',
    'projects',
    'worktrees',
    'about',
  ].map(
    (page, index): View => ({
      area: 'Settings',
      state: page,
      route: () => `/settings/${page}`,
      selector: main,
      themes: index === 0 ? allThemes : undefined,
      ready: `document.querySelector('[aria-label="Settings"] h1')`,
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
    ['thread actions', `Actions for ${checkoutTitle}`],
    ['thread grouping', 'Thread grouping: Date'],
    ['model loadout', 'Model:'],
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
        await click(
          page,
          state === 'model loadout'
            ? `document.querySelector('button[aria-label^="Model:"]')`
            : button(label!),
          'overlay trigger'
        )
      },
    })
  ),
]

views.push(
  {
    area: 'PR view',
    state: 'review comments',
    route: () => '/pull-requests/jettpbaker/pr-lab/1',
    selector: main,
    ready: `document.body.textContent.includes('Activity')`,
    async setup({ page }) {
      await page.evaluate(
        `[...document.querySelectorAll('h2,h3')].find(e=>e.textContent.trim()==='Activity').scrollIntoView({block:'start'})`
      )
    },
    verify: `document.body.textContent.includes('Preview looks right')`,
  },
  {
    area: 'PR view',
    state: 'checks',
    route: () => '/pull-requests/jettpbaker/pr-lab/1',
    selector: 'body',
    ready: `document.body.textContent.includes('Activity')`,
    async setup({ page }) {
      await click(page, text('All checks passed'), 'checkout checks')
      await waitFor(page, `document.querySelector('[aria-label="Search checks"]')`, 'checks list')
    },
  },
  {
    area: 'Bot',
    state: 'chat',
    route: (ctx) => `/bots/${ctx.ids.bot}`,
    selector: main,
    ready: `document.querySelector('[aria-label="Chat with Checkout"] textarea')`,
  },
  {
    area: 'Bot',
    state: 'overview',
    route: (ctx) => `/bots/${ctx.ids.bot}`,
    selector: '[aria-label="Bot details"]',
    ready: `document.querySelector('[aria-label="Chat with Checkout"] textarea')`,
    async setup({ page }) {
      await click(page, button('Open bot details'), 'bot details')
      await waitFor(
        page,
        `document.querySelector('[aria-label="Bot details"]').textContent.includes('Tasks')`,
        'bot task list'
      )
    },
  },
  {
    area: 'New thread',
    state: 'checkout draft',
    route: () => '/',
    selector: main,
    ready: prompt,
    async setup({ page }) {
      await click(page, prompt, 'new thread prompt')
      await page.cdp('Input.insertText', { text: checkoutPrompt })
    },
  },
  {
    area: 'Details pane',
    state: 'linked PR and children',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[aria-label="Thread details"]',
    ready: prompt,
    setup: details,
    verify: `document.querySelector('[aria-label="Thread details"]').textContent.includes('Audit tax rounding')`,
  },
  {
    area: 'Details pane',
    state: 'checkout changes',
    route: (ctx) => `/threads/${ctx.fixtures.threads.small}`,
    selector: '[aria-label="Thread details"]',
    ready: prompt,
    async setup(ctx) {
      await details(ctx)
      await click(ctx.page, text('Changes'), 'Changes tab')
      await waitFor(
        ctx.page,
        `[...document.querySelectorAll('diffs-container')].some(e=>e.shadowRoot?.querySelector('pre'))`,
        'checkout diff'
      )
    },
  },
  {
    area: 'Overlays',
    state: 'thread hover card',
    route: (ctx) => `/threads/${ctx.ids.tools}`,
    selector: 'body',
    ready: prompt,
    async setup({ page }) {
      const row = threadRow(checkoutTitle)
      await page.evaluate(`(${row}).scrollIntoView({block:'nearest'})`)
      const at = await page.evaluate<{ x: number; y: number }>(
        `(()=>{const r=(${row}).getBoundingClientRect();return {x:r.x+100,y:r.y+r.height/2}})()`
      )
      await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
      await waitFor(page, `document.querySelector('.thread-hover-panel')`, 'thread preview')
    },
  },
  {
    area: 'PR view',
    state: 'merge conflict',
    route: () => '/pull-requests/jettpbaker/pr-lab/2',
    selector: main,
    ready: `document.body.textContent.includes('Activity')`,
    async setup({ page }) {
      const at = await page.evaluate<{ x: number; y: number }>(
        `(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.disabled&&e.textContent.trim()==='Squash & merge');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
      )
      await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    },
    verify: `document.querySelector('[data-slot="tooltip-content"]')?.textContent.includes('Resolve merge conflicts first')`,
  },
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
      await click(
        page,
        button('Archive Remove legacy coupon endpoint'),
        'archive completed cleanup'
      )
      await waitFor(page, `document.querySelector('[data-sonner-toast]')`, 'undo toast')
    },
    async cleanup({ rpc, ids }) {
      await rpc.request('thread.archive', { threadId: ids.toast!, archived: false })
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
    setup: expandedWork,
  },
  {
    area: 'PR list',
    state: 'created empty',
    route: () => '/pull-requests?tab=created',
    selector: main,
    ready: `document.body.textContent.includes('No pull requests')`,
  }
)
