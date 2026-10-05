import type { ProviderModel } from '@jetty/shared/wire'

import { BunServices } from '@effect/platform-bun'
import { newId } from '@jetty/shared/wire'
import { afterEach, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Orchestrator } from './orchestrator'
import type { Store } from './store'

import { createAttachments } from './attachments'
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
  args: Record<string, unknown>
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
