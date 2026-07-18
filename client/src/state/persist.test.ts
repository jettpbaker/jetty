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
  parseThreadValue,
  persistChrome,
  persistThread,
} from './persist'
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

  test('collectHydration discards corrupt keys and keeps valid ones', () => {
    const chrome = sampleChrome()
    const thread = sampleThread()
    const { chrome: outChrome, threads } = collectHydration([
      ['chrome', chrome],
      ['thread:thr_1', thread],
      ['thread:thr_bad', { nope: true }],
      ['other', chrome],
      [1, thread],
    ])

    expect(outChrome).toEqual(chrome)
    expect(threads.size).toBe(1)
    expect(threads.get('thr_1')).toEqual(thread)
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
  test('persist then hydrate restores chrome and thread state', async () => {
    const chrome = sampleChrome()
    const thread = sampleThread(5)

    persistChrome(chrome)
    persistThread('thr_1', thread)
    await flushPendingWrites()

    const pairs = await entries()
    expect(pairs.length).toBe(2)

    const socket = mockSocket()
    const chromeStore = createChromeStore(socket)
    const timelineStore = createTimelineStore(socket)

    applyHydration(pairs, chromeStore, timelineStore)

    expect(chromeStore.getSnapshot()).toEqual(chrome)
    expect(timelineStore.getSnapshot('thr_1')).toEqual(thread)
  })

  test('garbage IDB values are discarded; boot proceeds with empty stores', async () => {
    const { set } = await import('idb-keyval')
    await set('chrome', { projects: 'broken' })
    await set('thread:thr_1', { lastSeq: 'nope' })
    await set('thread:thr_2', sampleThread(2))

    const pairs = await entries()
    const socket = mockSocket()
    const chromeStore = createChromeStore(socket)
    const timelineStore = createTimelineStore(socket)

    applyHydration(pairs, chromeStore, timelineStore)

    expect(chromeStore.getSnapshot()).toEqual({ projects: [], threads: [] })
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
