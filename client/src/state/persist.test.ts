import type { ChromePushData, Project, ThreadMeta } from '@jetty/shared/wire'

import { emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { entries } from 'idb-keyval'

import type { Socket } from '../socket'

import { createChromeStore, type ChromeState } from './chrome'
import {
  applyHydration,
  collectHydration,
  flushPendingWrites,
  parseChromeValue,
  parseTabsValue,
  parseThreadValue,
  persistChrome,
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

  test('collectHydration discards corrupt keys and keeps valid ones', () => {
    const chrome = sampleChrome()
    const thread = sampleThread()
    const {
      chrome: outChrome,
      tabs,
      threads,
    } = collectHydration([
      ['chrome', chrome],
      ['tabs', ['thr_1']],
      ['thread:thr_1', thread],
      ['thread:thr_bad', { nope: true }],
      ['other', chrome],
      [1, thread],
    ])

    expect(outChrome).toEqual(chrome)
    expect(tabs).toEqual(['thr_1'])
    expect(threads.size).toBe(1)
    expect(threads.get('thr_1')).toEqual(thread)
  })

  test('collectHydration drops a corrupt tabs entry', () => {
    const { tabs } = collectHydration([['tabs', ['thr_1', 42]]])
    expect(tabs).toBeNull()
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
  test('persist then hydrate restores chrome, tabs, and thread state', async () => {
    const chrome = sampleChrome()
    const thread = sampleThread(5)

    persistChrome(chrome)
    persistTabs(['thr_1', 'thr_2'])
    persistThread('thr_1', thread)
    await flushPendingWrites()

    const pairs = await entries()
    expect(pairs.length).toBe(3)

    const socket = mockSocket()
    const chromeStore = createChromeStore(socket)
    const tabsStore = createTabsStore()
    const timelineStore = createTimelineStore(socket)

    applyHydration(pairs, chromeStore, tabsStore, timelineStore)

    expect(chromeStore.getSnapshot()).toEqual(chrome)
    expect(tabsStore.getSnapshot()).toEqual(['thr_1', 'thr_2'])
    expect(timelineStore.getSnapshot('thr_1')).toEqual(thread)
  })

  test('garbage IDB values are discarded; boot proceeds with empty stores', async () => {
    const { set } = await import('idb-keyval')
    await set('chrome', { projects: 'broken' })
    await set('tabs', ['thr_1', 99])
    await set('thread:thr_1', { lastSeq: 'nope' })
    await set('thread:thr_2', sampleThread(2))

    const pairs = await entries()
    const socket = mockSocket()
    const chromeStore = createChromeStore(socket)
    const tabsStore = createTabsStore()
    const timelineStore = createTimelineStore(socket)

    applyHydration(pairs, chromeStore, tabsStore, timelineStore)

    expect(chromeStore.getSnapshot()).toEqual({ projects: [], threads: [] })
    expect(tabsStore.getSnapshot()).toEqual([])
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
