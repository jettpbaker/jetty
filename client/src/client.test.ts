import { emptyThread } from '@jetty/shared/reducer'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Integration suite runs against the echo agent — no network, no tokens.
process.env.JETTY_AGENT = 'echo'

import { startServer } from '../../server/src/main'
import { createSocket } from './socket'
import { createChromeStore } from './state/chrome'
import { createTimelineStore, MAX_WARM_SUBSCRIPTIONS } from './state/timeline'

type Running = ReturnType<typeof startServer>

const servers: Running[] = []
const homes: string[] = []
const sockets: Array<ReturnType<typeof createSocket>> = []

function boot() {
  const home = mkdtempSync(join(tmpdir(), 'jetty-client-'))
  homes.push(home)
  const running = startServer({ home, port: 0, hostname: '127.0.0.1', agent: 'echo' })
  servers.push(running)
  return running
}

function connectSocket(port: number) {
  const socket = createSocket(`ws://127.0.0.1:${port}/ws`)
  sockets.push(socket)
  return socket
}

function waitFor<T>(get: () => T, pred: (value: T) => boolean, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      const value = get()
      if (pred(value)) {
        resolve(value)
        return
      }
      if (Date.now() - start > ms) {
        reject(new Error('waitFor timed out'))
        return
      }
      setTimeout(tick, 20)
    }
    tick()
  })
}

afterEach(() => {
  while (sockets.length) sockets.pop()?.close()
  while (servers.length) servers.pop()?.stop()
  while (homes.length) {
    const home = homes.pop()
    if (home) rmSync(home, { recursive: true, force: true })
  }
})

describe('client socket + stores', () => {
  test('request/response round-trip', async () => {
    const { port } = boot()
    const socket = connectSocket(port)

    const { project } = await socket.request('project.create', {
      path: '/tmp/client-roundtrip',
      title: 'Roundtrip',
    })
    expect(project.path).toBe('/tmp/client-roundtrip')
    expect(project.title).toBe('Roundtrip')
    expect(project.id).toBeTruthy()
  })

  test('chrome snapshot + upsert push', async () => {
    const { port } = boot()
    const socket = connectSocket(port)
    const chrome = createChromeStore(socket)

    const snap0 = chrome.getSnapshot()
    expect(snap0).toBe(chrome.getSnapshot())

    await waitFor(
      () => chrome.getSnapshot(),
      (s) => s.projects.length === 0 && s.threads.length === 0
    )

    // after subscribe, snapshot push should land (may already be empty)
    const before = chrome.getSnapshot()

    const { project } = await socket.request('project.create', {
      path: '/tmp/chrome',
      title: 'Chrome',
    })

    const withProject = await waitFor(
      () => chrome.getSnapshot(),
      (s) => s.projects.some((p) => p.id === project.id)
    )
    expect(withProject).not.toBe(before)
    expect(withProject.projects[0]?.title).toBe('Chrome')
    expect(chrome.getSnapshot()).toBe(withProject)

    const { thread } = await socket.request('thread.create', { projectId: project.id })
    const withThread = await waitFor(
      () => chrome.getSnapshot(),
      (s) => s.threads.some((t) => t.id === thread.id)
    )
    expect(withThread.threads[0]?.projectId).toBe(project.id)
    expect(chrome.getSnapshot()).toBe(withThread)
  })

  test('openThread instant cache + afterSeq catch-up after reconnect', async () => {
    const { port } = boot()
    const socket = connectSocket(port)
    const timeline = createTimelineStore(socket)

    const { project } = await socket.request('project.create', { path: '/tmp/timeline' })
    const { thread } = await socket.request('thread.create', { projectId: project.id })

    // never visited → emptyThread constant (instant, zero network)
    const uncached = timeline.getSnapshot(thread.id)
    expect(uncached).toBe(emptyThread)

    const opened = timeline.openThread(thread.id)
    expect(opened).toBe(emptyThread)
    expect(timeline.getSnapshot(thread.id)).toBe(emptyThread)

    await socket.request('turn.start', { threadId: thread.id, text: 'first' })

    const afterTurn = await waitFor(
      () => timeline.getSnapshot(thread.id),
      (s) => s.status === 'idle' && s.items.some((i) => i.kind === 'assistant_message')
    )
    expect(afterTurn.lastSeq).toBeGreaterThan(0)
    const assistant = afterTurn.items.find((i) => i.kind === 'assistant_message')
    expect(assistant && 'text' in assistant ? assistant.text : null).toBe('first')
    expect(timeline.getSnapshot(thread.id)).toBe(afterTurn)

    const lastSeqBefore = afterTurn.lastSeq

    // force cold path via LRU eviction (not closeThread — that only clears open marker)
    const fillers: string[] = []
    for (let i = 0; i < MAX_WARM_SUBSCRIPTIONS; i++) {
      const { thread: filler } = await socket.request('thread.create', { projectId: project.id })
      fillers.push(filler.id)
      timeline.openThread(filler.id)
    }
    expect(timeline.getSnapshot(thread.id)).toBe(afterTurn)
    expect(timeline.getOpenThreadId()).toBe(fillers[fillers.length - 1] ?? null)

    // another client advances the log while we're unsubscribed (evicted)
    const other = connectSocket(port)
    const otherTimeline = createTimelineStore(other)
    otherTimeline.openThread(thread.id)
    await waitFor(
      () => otherTimeline.getSnapshot(thread.id),
      (s) => s.lastSeq >= lastSeqBefore
    )
    await other.request('turn.start', { threadId: thread.id, text: 'second' })
    await waitFor(
      () => otherTimeline.getSnapshot(thread.id),
      (s) => s.status === 'idle' && s.items.filter((i) => i.kind === 'user_message').length >= 2
    )
    const otherLast = otherTimeline.getSnapshot(thread.id).lastSeq
    expect(otherLast).toBeGreaterThan(lastSeqBefore)
    other.close()

    // cache still frozen at pre-gap seq
    expect(timeline.getSnapshot(thread.id).lastSeq).toBe(lastSeqBefore)

    // re-open: afterSeq catch-up patches the gap (same path onReconnect uses)
    timeline.openThread(thread.id)
    const caughtUp = await waitFor(
      () => timeline.getSnapshot(thread.id),
      (s) => s.lastSeq === otherLast
    )
    expect(caughtUp.lastSeq).toBe(otherLast)
    const users = caughtUp.items.filter((i) => i.kind === 'user_message')
    expect(users.length).toBeGreaterThanOrEqual(2)
    const texts = users.map((i) => ('text' in i ? i.text : ''))
    expect(texts).toContain('first')
    expect(texts).toContain('second')

    // simulated reconnect while thread is open: drop + re-open socket, re-sub with afterSeq
    const seqAtReconnect = timeline.getSnapshot(thread.id).lastSeq
    let reopened = 0
    socket.onReconnect(() => {
      reopened += 1
    })
    socket.reconnect()
    await waitFor(
      () => reopened,
      (n) => n >= 1
    )
    // connection is live again; a new turn should stream into the same cache
    await socket.request('turn.start', { threadId: thread.id, text: 'after-reconnect' })
    const afterReconnect = await waitFor(
      () => timeline.getSnapshot(thread.id),
      (s) =>
        s.lastSeq > seqAtReconnect &&
        s.items.some(
          (i) => i.kind === 'user_message' && 'text' in i && i.text === 'after-reconnect'
        )
    )
    expect(afterReconnect.lastSeq).toBeGreaterThan(seqAtReconnect)
  })

  test('background streaming: held thread advances without re-open', async () => {
    const { port } = boot()
    const socket = connectSocket(port)
    const timeline = createTimelineStore(socket)

    const { project } = await socket.request('project.create', { path: '/tmp/warm-bg' })
    const { thread: threadA } = await socket.request('thread.create', { projectId: project.id })
    const { thread: threadB } = await socket.request('thread.create', { projectId: project.id })

    timeline.openThread(threadA.id)
    await socket.request('turn.start', { threadId: threadA.id, text: 'seed-a' })
    const seeded = await waitFor(
      () => timeline.getSnapshot(threadA.id),
      (s) => s.status === 'idle' && s.lastSeq > 0
    )
    const seqBefore = seeded.lastSeq

    // navigate to B — A stays warm (closeThread only clears open marker)
    timeline.closeThread(threadA.id)
    timeline.openThread(threadB.id)
    expect(timeline.getOpenThreadId()).toBe(threadB.id)
    expect(timeline.getSnapshot(threadA.id).lastSeq).toBe(seqBefore)

    // second socket drives a turn in A; first client's A cache should advance
    const other = connectSocket(port)
    await other.request('turn.start', { threadId: threadA.id, text: 'bg-turn' })

    const advanced = await waitFor(
      () => timeline.getSnapshot(threadA.id),
      (s) =>
        s.lastSeq > seqBefore &&
        s.status === 'idle' &&
        s.items.some((i) => i.kind === 'user_message' && 'text' in i && i.text === 'bg-turn')
    )
    expect(advanced.lastSeq).toBeGreaterThan(seqBefore)
    expect(timeline.getOpenThreadId()).toBe(threadB.id)
  })

  test('LRU eviction freezes cache; re-open catch-up heals', async () => {
    const { port } = boot()
    const socket = connectSocket(port)
    const timeline = createTimelineStore(socket)

    const { project } = await socket.request('project.create', { path: '/tmp/lru' })
    const { thread: lru } = await socket.request('thread.create', { projectId: project.id })

    timeline.openThread(lru.id)
    await socket.request('turn.start', { threadId: lru.id, text: 'lru-seed' })
    const seeded = await waitFor(
      () => timeline.getSnapshot(lru.id),
      (s) => s.status === 'idle' && s.lastSeq > 0
    )
    const frozenSeq = seeded.lastSeq

    // visit N more threads → lru is least-recent and unsubscribed (cache kept)
    for (let i = 0; i < MAX_WARM_SUBSCRIPTIONS; i++) {
      const { thread: filler } = await socket.request('thread.create', { projectId: project.id })
      timeline.openThread(filler.id)
    }

    // another client drives the thread while primary is unsubscribed
    const other = connectSocket(port)
    const observer = createTimelineStore(other)
    observer.openThread(lru.id)
    await waitFor(
      () => observer.getSnapshot(lru.id),
      (s) => s.lastSeq >= frozenSeq
    )
    await other.request('turn.start', { threadId: lru.id, text: 'while-evicted' })
    await waitFor(
      () => observer.getSnapshot(lru.id),
      (s) =>
        s.status === 'idle' &&
        s.items.some((i) => i.kind === 'user_message' && 'text' in i && i.text === 'while-evicted')
    )
    const serverLast = observer.getSnapshot(lru.id).lastSeq
    expect(serverLast).toBeGreaterThan(frozenSeq)

    // primary cache frozen — no pushes while unsubscribed
    expect(timeline.getSnapshot(lru.id).lastSeq).toBe(frozenSeq)

    // re-open heals via afterSeq catch-up
    timeline.openThread(lru.id)
    const healed = await waitFor(
      () => timeline.getSnapshot(lru.id),
      (s) => s.lastSeq === serverLast
    )
    expect(healed.lastSeq).toBe(serverLast)
    const texts = healed.items
      .filter((i) => i.kind === 'user_message')
      .map((i) => ('text' in i ? i.text : ''))
    expect(texts).toContain('lru-seed')
    expect(texts).toContain('while-evicted')
  })

  test('reconnect re-subscribes all held threads', async () => {
    const { port } = boot()
    const socket = connectSocket(port)
    const timeline = createTimelineStore(socket)

    const { project } = await socket.request('project.create', { path: '/tmp/reconnect-held' })
    const { thread: threadA } = await socket.request('thread.create', { projectId: project.id })
    const { thread: threadB } = await socket.request('thread.create', { projectId: project.id })

    timeline.openThread(threadA.id)
    await socket.request('turn.start', { threadId: threadA.id, text: 'a0' })
    await waitFor(
      () => timeline.getSnapshot(threadA.id),
      (s) => s.status === 'idle' && s.lastSeq > 0
    )

    timeline.closeThread(threadA.id)
    timeline.openThread(threadB.id)
    await socket.request('turn.start', { threadId: threadB.id, text: 'b0' })
    await waitFor(
      () => timeline.getSnapshot(threadB.id),
      (s) => s.status === 'idle' && s.lastSeq > 0
    )

    const seqA = timeline.getSnapshot(threadA.id).lastSeq
    const seqB = timeline.getSnapshot(threadB.id).lastSeq

    let reopened = 0
    socket.onReconnect(() => {
      reopened += 1
    })
    socket.reconnect()
    await waitFor(
      () => reopened,
      (n) => n >= 1
    )

    // both held: open is B, A is warm — post-reconnect turns stream into both caches
    await socket.request('turn.start', { threadId: threadA.id, text: 'a-after' })
    await socket.request('turn.start', { threadId: threadB.id, text: 'b-after' })

    const aAfter = await waitFor(
      () => timeline.getSnapshot(threadA.id),
      (s) =>
        s.lastSeq > seqA &&
        s.items.some((i) => i.kind === 'user_message' && 'text' in i && i.text === 'a-after')
    )
    const bAfter = await waitFor(
      () => timeline.getSnapshot(threadB.id),
      (s) =>
        s.lastSeq > seqB &&
        s.items.some((i) => i.kind === 'user_message' && 'text' in i && i.text === 'b-after')
    )
    expect(aAfter.lastSeq).toBeGreaterThan(seqA)
    expect(bAfter.lastSeq).toBeGreaterThan(seqB)
    expect(timeline.getOpenThreadId()).toBe(threadB.id)
  })

  test('turn events stream into ThreadState via shared reducer', async () => {
    const { port } = boot()
    const socket = connectSocket(port)
    const timeline = createTimelineStore(socket)

    const { project } = await socket.request('project.create', { path: '/tmp/reduce' })
    const { thread } = await socket.request('thread.create', { projectId: project.id })
    timeline.openThread(thread.id)

    const { turnId } = await socket.request('turn.start', {
      threadId: thread.id,
      text: 'reduce-me',
    })
    expect(turnId).toBeTruthy()

    const final = await waitFor(
      () => timeline.getSnapshot(thread.id),
      (s) => s.status === 'idle' && s.activeTurnId === null && s.lastSeq > 0
    )

    expect(final.items.length).toBeGreaterThan(0)

    const user = final.items.find((i) => i.kind === 'user_message')
    expect(user).toMatchObject({ kind: 'user_message', text: 'reduce-me', turnId })

    const assistant = final.items.find((i) => i.kind === 'assistant_message')
    expect(assistant).toMatchObject({ kind: 'assistant_message', text: 'reduce-me' })

    const tool = final.items.find((i) => i.kind === 'tool_call')
    expect(tool).toMatchObject({
      kind: 'tool_call',
      toolName: 'echo',
      status: 'succeeded',
      output: 'echo: reduce-me',
    })
  })

  test('error responses reject with wire error payload', async () => {
    const { port } = boot()
    const socket = connectSocket(port)

    try {
      await socket.request('thread.subscribe', { threadId: 'missing' })
      expect.unreachable('should have rejected')
    } catch (err) {
      expect(err).toMatchObject({ code: 'not_found' })
    }
  })
})
