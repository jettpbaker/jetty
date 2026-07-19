import type { ChromePushData, Project, ThreadMeta } from '@jetty/shared/wire'

import { emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { entries } from 'idb-keyval'

import type { Socket } from '../socket'

import { createChromeStore, type ChromeState } from './chrome'
import { createDraftsStore } from './drafts'
import {
  applyHydration,
  collectHydration,
  flushPendingWrites,
  parseChromeValue,
  parseDraftsValue,
  parseTabsValue,
  parseThreadValue,
  persistChrome,
  persistDrafts,
  persistTabs,
  persistThread,
} from './persist'
import { createTabsStore } from './tabs'
import { createTimelineStore } from './timeline'

import 'fake-indexeddb/auto'

function mockSocket(): Socket {
  return {
    request: async () => ({}) as never,
    onChromePush: () => () => {},
    onThreadPush: () => () => {},
    onReconnect: () => () => {},
    reconnect: () => {},
    close: () => {},
  }
}

function sampleChrome(): ChromeState {
  const project: Project = {
    id: 'proj_1',
    path: '/tmp/jetty',
    title: 'Jetty',
    createdAt: 1,
  }
  const thread: ThreadMeta = {
    id: 'thr_1',
    projectId: project.id,
    title: 'Hello',
    status: 'idle',
    archived: false,
    updatedAt: 2,
  }
  return { projects: [project], threads: [thread] }
}

function sampleThread(lastSeq = 3): ThreadState {
  return {
    items: [
      {
        kind: 'user_message',
        id: 'item_1',
        turnId: 'turn_1',
        createdAt: 1,
        text: 'hi',
        attachments: [],
      },
    ],
    status: 'idle',
    activeTurnId: null,
    lastSeq,
  }
}

async function clearIdb(): Promise<void> {
  await flushPendingWrites()
  const { clear } = await import('idb-keyval')
  await clear()
}

beforeEach(async () => {
  await clearIdb()
})

afterEach(async () => {
  await clearIdb()
})

describe('persist parse/discard', () => {
  test('parseChromeValue accepts valid chrome and rejects garbage', () => {
    const good = sampleChrome()
    expect(parseChromeValue(good)).toEqual(good)
    expect(parseChromeValue(null)).toBeNull()
    expect(parseChromeValue({ projects: 'nope', threads: [] })).toBeNull()
    expect(parseChromeValue({ projects: [{ id: 1 }], threads: [] })).toBeNull()
  })

  test('parseThreadValue accepts valid ThreadState and rejects garbage', () => {
    const good = sampleThread()
    expect(parseThreadValue(good)).toEqual(good)
    expect(parseThreadValue(undefined)).toBeNull()
    expect(parseThreadValue({ lastSeq: 'x' })).toBeNull()
    expect(parseThreadValue({ ...good, status: 'not-a-status' })).toBeNull()
  })

  test('parseTabsValue accepts a string array and rejects garbage', () => {
    expect(parseTabsValue(['thr_1', 'thr_2'])).toEqual(['thr_1', 'thr_2'])
    expect(parseTabsValue([])).toEqual([])
    expect(parseTabsValue(null)).toBeNull()
    expect(parseTabsValue(['thr_1', 3])).toBeNull()
  })

  test('parseDraftsValue accepts a draft array and rejects garbage', () => {
    const good = [{ id: 'dr_1', projectId: 'proj_1' }]
    expect(parseDraftsValue(good)).toEqual(good)
    expect(parseDraftsValue([])).toEqual([])
    expect(parseDraftsValue(null)).toBeNull()
    expect(parseDraftsValue([{ id: 'dr_1' }])).toBeNull()
    expect(parseDraftsValue([{ id: 1, projectId: 'proj_1' }])).toBeNull()
  })

  test('collectHydration discards corrupt keys and keeps valid ones', () => {
    const chrome = sampleChrome()
    const thread = sampleThread()
    const drafts = [{ id: 'dr_1', projectId: 'proj_1' }]
    const {
      chrome: outChrome,
      tabs,
      drafts: outDrafts,
      threads,
    } = collectHydration([
      ['chrome', chrome],
      ['tabs', ['thr_1']],
      ['drafts', drafts],
      ['thread:thr_1', thread],
      ['thread:thr_bad', { nope: true }],
      ['other', chrome],
      [1, thread],
    ])

    expect(outChrome).toEqual(chrome)
    expect(tabs).toEqual(['thr_1'])
    expect(outDrafts).toEqual(drafts)
    expect(threads.size).toBe(1)
    expect(threads.get('thr_1')).toEqual(thread)
  })

  test('collectHydration drops a corrupt tabs entry', () => {
    const { tabs } = collectHydration([['tabs', ['thr_1', 42]]])
    expect(tabs).toBeNull()
  })

  test('collectHydration drops a corrupt drafts entry', () => {
    const { drafts } = collectHydration([['drafts', [{ id: 'dr_1' }]]])
    expect(drafts).toBeNull()
  })

  test('collectHydration drops a corrupt chrome entry', () => {
    const { chrome: out } = collectHydration([
      ['thread:x', 'bad'],
      ['chrome', { projects: 'nope', threads: [] }],
    ])
    expect(out).toBeNull()
  })
})

describe('persist round-trip via IndexedDB', () => {
  test('persist then hydrate restores chrome, tabs, drafts, and thread state', async () => {
    const chrome = sampleChrome()
    const thread = sampleThread(5)
    const drafts = [
      { id: 'dr_1', projectId: 'proj_1' },
      { id: 'dr_2', projectId: 'proj_1' },
    ]

    persistChrome(chrome)
    persistTabs(['thr_1', 'thr_2', 'dr_1'])
    persistDrafts(drafts)
    persistThread('thr_1', thread)
    await flushPendingWrites()

    const pairs = await entries()
    expect(pairs.length).toBe(4)

    const socket = mockSocket()
    const chromeStore = createChromeStore(socket)
    const tabsStore = createTabsStore()
    const draftsStore = createDraftsStore()
    const timelineStore = createTimelineStore(socket)

    applyHydration(pairs, chromeStore, tabsStore, timelineStore, draftsStore)

    expect(chromeStore.getSnapshot()).toEqual(chrome)
    expect(tabsStore.getSnapshot()).toEqual(['thr_1', 'thr_2', 'dr_1'])
    expect(draftsStore.getSnapshot()).toEqual(drafts)
    expect(timelineStore.getSnapshot('thr_1')).toEqual(thread)
  })

  test('garbage IDB values are discarded; boot proceeds with empty stores', async () => {
    const { set } = await import('idb-keyval')
    await set('chrome', { projects: 'broken' })
    await set('tabs', ['thr_1', 99])
    await set('drafts', [{ id: 'dr_1' }])
    await set('thread:thr_1', { lastSeq: 'nope' })
    await set('thread:thr_2', sampleThread(2))

    const pairs = await entries()
    const socket = mockSocket()
    const chromeStore = createChromeStore(socket)
    const tabsStore = createTabsStore()
    const draftsStore = createDraftsStore()
    const timelineStore = createTimelineStore(socket)

    applyHydration(pairs, chromeStore, tabsStore, timelineStore, draftsStore)

    expect(chromeStore.getSnapshot()).toEqual({ projects: [], threads: [] })
    expect(tabsStore.getSnapshot()).toEqual([])
    expect(draftsStore.getSnapshot()).toEqual([])
    expect(timelineStore.getSnapshot('thr_1')).toBe(emptyThread)
    expect(timelineStore.getSnapshot('thr_2').lastSeq).toBe(2)
  })
})

describe('store hydrate seams', () => {
  test('chrome.hydrate is a no-op after a server snapshot', () => {
    let push: ((data: ChromePushData) => void) | undefined
    const sock: Socket = {
      request: async () => ({}) as never,
      onChromePush(handler) {
        push = handler
        return () => {
          push = undefined
        }
      },
      onThreadPush: () => () => {},
      onReconnect: () => () => {},
      reconnect: () => {},
      close: () => {},
    }

    const store = createChromeStore(sock)
    expect(push).toBeDefined()
    push!({
      type: 'snapshot',
      projects: sampleChrome().projects,
      threads: sampleChrome().threads,
    })

    const fromServer = store.getSnapshot()
    store.hydrate({ projects: [], threads: [] })
    expect(store.getSnapshot()).toBe(fromServer)
  })

  test('tabs.hydrate is a no-op after a mutation landed', () => {
    const store = createTabsStore()
    store.open('thr_1')
    store.hydrate(['thr_9'])
    expect(store.getSnapshot()).toEqual(['thr_1'])
  })

  test('tabs.hydrate seeds an untouched store', () => {
    const store = createTabsStore()
    store.hydrate(['thr_1', 'thr_2'])
    expect(store.getSnapshot()).toEqual(['thr_1', 'thr_2'])
  })

  test('drafts.hydrate is a no-op after a mutation landed', () => {
    const store = createDraftsStore()
    store.create('proj_1')
    store.hydrate([{ id: 'dr_9', projectId: 'proj_9' }])
    expect(store.getSnapshot()).toHaveLength(1)
    expect(store.getSnapshot()[0]?.projectId).toBe('proj_1')
  })

  test('drafts.hydrate seeds an untouched store', () => {
    const store = createDraftsStore()
    const list = [{ id: 'dr_1', projectId: 'proj_1' }]
    store.hydrate(list)
    expect(store.getSnapshot()).toEqual(list)
  })

  test('timeline.hydrateThread rejects stale lastSeq', () => {
    const store = createTimelineStore(mockSocket())
    store.hydrateThread('thr_1', sampleThread(5))
    expect(store.getSnapshot('thr_1').lastSeq).toBe(5)

    store.hydrateThread('thr_1', sampleThread(3))
    expect(store.getSnapshot('thr_1').lastSeq).toBe(5)

    store.hydrateThread('thr_1', sampleThread(8))
    expect(store.getSnapshot('thr_1').lastSeq).toBe(8)
  })

  test('hydrated thread with lastSeq > 0 takes warm openThread path (subscribe afterSeq)', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const sock: Socket = {
      request: async (method, params) => {
        calls.push({ method, params })
        return {} as never
      },
      onChromePush: () => () => {},
      onThreadPush: () => () => {},
      onReconnect: () => () => {},
      reconnect: () => {},
      close: () => {},
    }

    const store = createTimelineStore(sock)
    store.hydrateThread('thr_1', sampleThread(4))
    store.openThread('thr_1')

    expect(calls).toEqual([
      { method: 'thread.subscribe', params: { threadId: 'thr_1', afterSeq: 4 } },
    ])
  })
})
