import type { ProviderModel } from '@jetty/shared/wire'

import { BunServices } from '@effect/platform-bun'
import { newId, type WireError } from '@jetty/shared/wire'
import { afterEach, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Orchestrator } from './orchestrator'
import type { Store } from './store'
import type { Worktrees } from './worktrees'

import { createAttachments } from './attachments'
import { botUserName } from './bot-home'
import { createHub } from './hub'
import { createMcpHandler } from './mcp'
import { createMcpSessions } from './mcp-sessions'
import { createPullRequestLinks, createPullRequests } from './pull-requests'
import { StoreError } from './store'
import { openTestStore } from './store-fixture'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

const catalog: ProviderModel[] = [
  { provider: 'claude', id: 'haiku', name: 'Haiku', efforts: [], fast: false, autoMode: false },
  { provider: 'claude', id: 'sonnet', name: 'Sonnet', efforts: [], fast: false, autoMode: true },
]

async function openStore() {
  const home = mkdtempSync(join(tmpdir(), 'jetty-mcp-'))
  const { store, close } = await openTestStore(home)
  cleanup.push(async () => {
    await close()
    rmSync(home, { recursive: true, force: true })
  })
  return { home, store }
}

function callTool(
  home: string,
  store: Store,
  orch: Partial<Orchestrator>,
  callerId: string,
  name: string,
  args: Record<string, unknown>,
  archiveThread: (threadId: string) => Effect.Effect<unknown, WireError> = () => Effect.void,
  worktrees?: Worktrees
) {
  return Effect.gen(function* () {
    const sessions = createMcpSessions()
    sessions.setUrl('http://127.0.0.1/mcp')
    const binding = yield* sessions.open({ threadId: callerId, provider: 'claude' })
    const hub = createHub()
    const scope = yield* Effect.scope
    const handle = yield* createMcpHandler(
      sessions,
      store,
      { withAdmission: (_: string, effect: unknown) => effect, ...orch } as unknown as Orchestrator,
      yield* createAttachments(home),
      () => catalog,
      createPullRequestLinks(store, hub, createPullRequests(store, hub), scope),
      archiveThread,
      worktrees
    )
    const response = yield* Effect.promise(() =>
      handle(
        new Request(binding.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${binding.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        })
      ).then((res) => res.json())
    )
    return (response as { result: { isError?: boolean; content: { text: string }[] } }).result
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
}

async function botCaller() {
  const { home, store } = await openStore()
  const id = newId()
  mkdirSync(join(home, 'bots', id), { recursive: true })
  await Effect.runPromise(
    store.createBotRecord(
      {
        id,
        name: 'Verify',
        shape: 'circle',
        color: 'coral',
        provider: 'claude',
        model: 'sonnet',
        effort: 'medium',
        fast: false,
        projectId: null,
        permissionMode: 'auto',
      },
      join(home, 'bots', id)
    )
  )
  await Effect.runPromise(store.beginDelivery(id, newId(), 0))
  return { home, store, id }
}

function toolNames(home: string, store: Store, callerId: string) {
  return Effect.gen(function* () {
    const sessions = createMcpSessions()
    sessions.setUrl('http://127.0.0.1/mcp')
    const binding = yield* sessions.open({ threadId: callerId, provider: 'claude' })
    const hub = createHub()
    const scope = yield* Effect.scope
    const handle = yield* createMcpHandler(
      sessions,
      store,
      {} as Orchestrator,
      yield* createAttachments(home),
      () => catalog,
      createPullRequestLinks(store, hub, createPullRequests(store, hub), scope),
      () => Effect.void
    )
    const response = yield* Effect.promise(() =>
      handle(
        new Request(binding.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${binding.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
      ).then((res) => res.json())
    )
    return (response as { result: { tools: { name: string }[] } }).result.tools.map(
      (tool) => tool.name
    )
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
}

test('bots only receive their own safe tools', async () => {
  const { home, store, id } = await botCaller()
  const names = await Effect.runPromise(toolNames(home, store, id))
  expect(names).toContain('tell_user')
  expect(names).toContain('react')
  for (const forbidden of [
    'link_pull_request',
    'mark_ready_for_review',
    'ask_parent',
    'send_images',
    'send_video',
  ])
    expect(names).not.toContain(forbidden)
})

test('bot react result names what writing after a reaction means', async () => {
  const { home, store, id } = await botCaller()
  const result = await Effect.runPromise(
    callTool(
      home,
      store,
      {
        botReaction: () => Effect.succeed(true),
      },
      id,
      'react',
      { emoji: '👍' }
    )
  )
  expect(result.isError).toBeUndefined()
  expect(JSON.parse(result.content[0]!.text)).toEqual({
    reacted: '👍',
    note: `If that's your whole reply, end your turn now without writing anything. In a turn ${await botUserName()} started, any text you write is sent to them as a message.`,
  })
})

test('bot create_thread refuses max effort', async () => {
  const { home, store, id } = await botCaller()
  const result = await Effect.runPromise(
    callTool(home, store, {}, id, 'create_thread', {
      prompt: 'Go',
      effort: 'max',
      environment: 'local',
    })
  )
  expect(result.isError).toBe(true)
  expect(result.content[0]!.text).toBe("max isn't available to bots; use xhigh")
})

test('create_thread allows three worker levels and refuses the fourth', async () => {
  const { home, store } = await openStore()
  const project = await Effect.runPromise(store.createProject(home))
  const root = await Effect.runPromise(store.createThread(project.id, newId()))
  let parent = root
  let allowedParent = root
  for (let depth = 1; depth <= 3; depth++) {
    const child = await Effect.runPromise(store.createThread(project.id, newId()))
    await Effect.runPromise(store.markAgentThread(child.id, parent.id, false))
    parent = child
    if (depth === 2) allowedParent = child
  }
  await Effect.runPromise(store.beginDelivery(allowedParent.id, newId(), 0))
  const allowed = await Effect.runPromise(
    callTool(home, store, {}, allowedParent.id, 'create_thread', {
      prompt: 'Third level',
      environment: 'local',
    })
  )
  expect(allowed.isError).toBeUndefined()
  await Effect.runPromise(store.beginDelivery(parent.id, newId(), 0))
  const refused = await Effect.runPromise(
    callTool(home, store, {}, parent.id, 'create_thread', {
      prompt: 'One more',
      environment: 'local',
    })
  )
  expect(refused.isError).toBe(true)
  expect(refused.content[0]!.text).toContain('three levels below')
})

test('create_thread refuses a child that would act without asking for a caller that asks', async () => {
  const { home, store } = await openStore()
  const createThread = (model?: string) =>
    Effect.gen(function* () {
      const project = yield* store.createProject(home)
      const caller = yield* store.createThread(project.id, newId())
      yield* store.setThreadProviderIfAbsent(caller.id, 'claude')
      yield* store.setThreadLoadout(caller.id, { model: 'haiku' })
      yield* store.beginDelivery(caller.id, newId(), 0)
      return yield* callTool(home, store, {}, caller.id, 'create_thread', {
        environment: 'local',
        prompt: 'Go',
        ...(model ? { model } : {}),
      })
    })

  const escalated = await Effect.runPromise(createThread('sonnet'))
  expect(escalated.isError).toBe(true)
  expect(escalated.content[0]!.text).toContain('asks before acting')
  const same = await Effect.runPromise(createThread())
  expect(same.isError).toBeUndefined()
})

test('create_thread can start a child in another project', async () => {
  const { home, store } = await openStore()
  mkdirSync(join(home, 'alpha'))
  mkdirSync(join(home, 'beta'))
  const alpha = await Effect.runPromise(store.createProject(join(home, 'alpha')))
  const beta = await Effect.runPromise(store.createProject(join(home, 'beta')))
  await Effect.runPromise(store.renameProject(alpha.id, 'Docs'))
  await Effect.runPromise(store.renameProject(beta.id, 'API'))
  const caller = await Effect.runPromise(store.createThread(alpha.id, newId()))
  await Effect.runPromise(store.beginDelivery(caller.id, newId(), 0))
  const resolved: { cwd: string; ref?: string }[] = []
  const defaults: string[] = []
  const worktrees = {
    defaultEnvironment: async (path: string) => {
      defaults.push(path)
      return path === beta.path ? 'worktree' : 'local'
    },
    resolveRef: async (cwd: string, ref?: string) => {
      resolved.push({ cwd, ref })
      return 'target-base'
    },
    root: async () => alpha.path,
  } as unknown as Worktrees
  const tool = (args: Record<string, unknown>) =>
    Effect.runPromise(
      callTool(home, store, {}, caller.id, 'create_thread', args, () => Effect.void, worktrees)
    )

  const created = await tool({ prompt: 'Go', project: 'api' })
  expect(created.isError).toBeUndefined()
  const { threadId } = JSON.parse(created.content[0]!.text) as { threadId: string }
  const child = await Effect.runPromise(store.requireThread(threadId))
  expect(child.projectId).toBe(beta.id)
  expect(child.parentThreadId).toBe(caller.id)
  expect(child.environment).toBe('worktree')
  expect(await Effect.runPromise(store.getWorktree(threadId))).toMatchObject({
    baseCommit: 'target-base',
  })
  expect(defaults).toEqual([beta.path])
  expect(resolved).toEqual([{ cwd: beta.path, ref: undefined }])

  const same = await tool({ prompt: 'Stay' })
  expect(same.isError).toBeUndefined()
  const sameId = (JSON.parse(same.content[0]!.text) as { threadId: string }).threadId
  expect((await Effect.runPromise(store.requireThread(sameId))).projectId).toBe(alpha.id)

  const missing = await tool({ prompt: 'Nope', project: 'missing' })
  expect(missing.isError).toBe(true)
  expect(missing.content[0]!.text).toContain('Unknown project missing')
  expect(missing.content[0]!.text).toContain('Available:')
  expect(missing.content[0]!.text).toContain('Docs')
  expect(missing.content[0]!.text).toContain('API')

  await Effect.runPromise(store.renameProject(alpha.id, 'App'))
  await Effect.runPromise(store.renameProject(beta.id, 'App'))
  const ambiguous = await tool({ prompt: 'Nope', project: 'app' })
  expect(ambiguous.isError).toBe(true)
  expect(ambiguous.content[0]!.text).toContain('Ambiguous project app')
  expect(ambiguous.content[0]!.text).toContain('Available: App, App')
})

test('send_message restarts a stopped child with the message, even if Jetty dies right after', async () => {
  const { home, store } = await openStore()
  const project = await Effect.runPromise(store.createProject(home))
  const parent = await Effect.runPromise(store.createThread(project.id, newId()))
  const child = await Effect.runPromise(store.createThread(project.id, newId()))
  await Effect.runPromise(store.beginDelivery(parent.id, newId(), 0))
  await Effect.runPromise(store.markAgentThread(child.id, parent.id, false))
  await Effect.runPromise(store.setQueuePaused(child.id, true))
  const send = (orch: Partial<Orchestrator>) =>
    Effect.runPromise(
      callTool(home, store, orch, parent.id, 'send_message', {
        threadId: child.id,
        text: 'carry on',
        requestId: 'once',
      })
    )
  const queued = async () =>
    (await Effect.runPromise(store.requireThread(child.id))).pendingMessages ?? []

  const crashed = await send({
    queueResumed: () => Effect.fail(new StoreError('conflict', 'Jetty died')),
  })
  expect(crashed.isError).toBe(true)
  expect(await Effect.runPromise(store.isQueuePaused(child.id))).toBe(false)
  expect(await queued()).toHaveLength(1)

  await Effect.runPromise(store.setQueuePaused(child.id, true))
  const retried = await send({})
  expect(retried.isError).toBeUndefined()
  expect(await Effect.runPromise(store.isQueuePaused(child.id))).toBe(true)
  expect(await queued()).toHaveLength(1)
})

test('archive_thread reaches any idle thread, and stop_thread stays on direct children', async () => {
  const { home, store } = await openStore()
  mkdirSync(join(home, 'other'))
  const project = await Effect.runPromise(store.createProject(home))
  const elsewhere = await Effect.runPromise(store.createProject(join(home, 'other')))
  const make = async (projectId: string, title: string, parentId?: string) => {
    const thread = await Effect.runPromise(store.createThread(projectId, newId()))
    await Effect.runPromise(store.setThreadTitle(thread.id, title))
    if (parentId) await Effect.runPromise(store.markAgentThread(thread.id, parentId, false))
    return thread
  }
  const root = await make(project.id, 'Root')
  const parent = await make(project.id, 'Parent', root.id)
  const caller = await make(project.id, 'Caller', parent.id)
  const child = await make(project.id, 'Child', caller.id)
  const grandchild = await make(project.id, 'Grandchild', child.id)
  const idle = await make(project.id, 'Old notes')
  const busy = await make(project.id, 'Live')
  const busyParent = await make(project.id, 'Notes')
  const busyChild = await make(project.id, 'Notes worker', busyParent.id)
  const foreign = await make(elsewhere.id, 'Foreign')
  const start = (id: string) =>
    Effect.runPromise(store.appendEvent(id, { type: 'turn.started', turnId: newId() }))
  await start(child.id)
  await start(grandchild.id)
  await start(busy.id)
  await start(busyChild.id)

  const archived: string[] = []
  const stopped: string[] = []
  const tool = (name: string, threadId: string) =>
    Effect.runPromise(
      callTool(
        home,
        store,
        { stopThread: (id) => Effect.sync(() => void stopped.push(id)) },
        caller.id,
        name,
        { threadId },
        (id) => Effect.sync(() => void archived.push(id))
      )
    )

  const oldNotes = await tool('archive_thread', idle.id)
  expect(oldNotes.isError).toBeUndefined()
  expect(JSON.parse(oldNotes.content[0]!.text)).toMatchObject({
    threadId: idle.id,
    title: 'Old notes',
    archived: true,
  })
  expect(archived).toEqual([idle.id])

  const ownChild = await tool('archive_thread', child.id)
  const ownGrandchild = await tool('archive_thread', grandchild.id)
  expect(ownChild.isError).toBeUndefined()
  expect(ownGrandchild.isError).toBeUndefined()
  expect(archived).toEqual([idle.id, child.id, grandchild.id])

  const self = await tool('archive_thread', caller.id)
  const above = await tool('archive_thread', parent.id)
  const higher = await tool('archive_thread', root.id)
  expect(self.content[0]!.text).toContain("can't archive this thread")
  expect(above.content[0]!.text).toContain('above yours')
  expect(higher.content[0]!.text).toContain('above yours')

  const live = await tool('archive_thread', busy.id)
  const notes = await tool('archive_thread', busyParent.id)
  expect(live.content[0]!.text).toBe(
    "Live is still working. Ask the user, or wait until it's done."
  )
  expect(notes.content[0]!.text).toBe(
    "Notes is still working. Ask the user, or wait until it's done."
  )
  expect(archived).toEqual([idle.id, child.id, grandchild.id])

  await Effect.runPromise(store.archiveThread(idle.id, true))
  const again = await tool('archive_thread', idle.id)
  expect(again.content[0]!.text).toBe('Thread is already archived')

  const outside = await tool('archive_thread', foreign.id)
  expect(outside.isError).toBeUndefined()
  expect(JSON.parse(outside.content[0]!.text)).toMatchObject({
    threadId: foreign.id,
    title: 'Foreign',
    archived: true,
  })
  expect(archived).toEqual([idle.id, child.id, grandchild.id, foreign.id])

  const stopOther = await tool('stop_thread', idle.id)
  expect(stopOther.content[0]!.text).toBe('Only your own direct child threads can be stopped')
  const stopChild = await tool('stop_thread', child.id)
  expect(stopChild.isError).toBeUndefined()
  expect(stopped).toEqual([child.id])
})
