import type { ProviderModel } from '@jetty/shared/wire'

import { BunServices } from '@effect/platform-bun'
import { newId } from '@jetty/shared/wire'
import { afterEach, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Orchestrator } from './orchestrator'

import { createAttachments } from './attachments'
import { createHub } from './hub'
import { createMcpHandler } from './mcp'
import { createMcpSessions } from './mcp-sessions'
import { createPullRequestLinks, createPullRequests } from './pull-requests'
import { openTestStore } from './store-fixture'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

const catalog: ProviderModel[] = [
  { provider: 'claude', id: 'haiku', name: 'Haiku', efforts: [], fast: false, autoMode: false },
  { provider: 'claude', id: 'sonnet', name: 'Sonnet', efforts: [], fast: false, autoMode: true },
]

test('create_thread refuses a child that would act without asking for a caller that asks', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jetty-mcp-'))
  const { store, close } = await openTestStore(home)
  cleanup.push(async () => {
    await close()
    rmSync(home, { recursive: true, force: true })
  })
  const createThread = (model?: string) =>
    Effect.gen(function* () {
      const project = yield* store.createProject(home)
      const caller = yield* store.createThread(project.id, newId())
      yield* store.setThreadProviderIfAbsent(caller.id, 'claude')
      yield* store.setThreadLoadout(caller.id, { model: 'haiku' })
      yield* store.beginDelivery(caller.id, newId(), 0)
      const sessions = createMcpSessions()
      sessions.setUrl('http://127.0.0.1/mcp')
      const binding = yield* sessions.open({ threadId: caller.id, provider: 'claude' })
      const hub = createHub()
      const scope = yield* Effect.scope
      const handle = yield* createMcpHandler(
        sessions,
        store,
        { withAdmission: (_: string, effect: unknown) => effect } as unknown as Orchestrator,
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
              params: {
                name: 'create_thread',
                arguments: { environment: 'local', prompt: 'Go', ...(model ? { model } : {}) },
              },
            }),
          })
        ).then((res) => res.json())
      )
      return (response as { result: { isError?: boolean; content: { text: string }[] } }).result
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))

  const escalated = await Effect.runPromise(createThread('sonnet'))
  expect(escalated.isError).toBe(true)
  expect(escalated.content[0]!.text).toContain('asks before acting')
  const same = await Effect.runPromise(createThread())
  expect(same.isError).toBeUndefined()
})
