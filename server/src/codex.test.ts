import type { ThreadEvent } from '@jetty/shared/events'

import { BunServices } from '@effect/platform-bun'
import { ThreadEvent as EventSchema } from '@jetty/shared/events'
import { newId } from '@jetty/shared/wire'
import { afterEach, expect, test } from 'bun:test'
import { Context, Effect, Exit, Layer, ManagedRuntime, Schema } from 'effect'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentError, type Emit } from './agent'
import { createCodexAdapter, type CodexOptions } from './codex'
import { createCodexTranslator } from './codex-translate'
import { databaseLayer } from './db'
import { Store, storeLayer } from './store'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function setup(options: CodexOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jetty-codex-'))
  const storeRuntime = ManagedRuntime.make(
    storeLayer.pipe(Layer.provide(databaseLayer(home)), Layer.provide(BunServices.layer))
  )
  const store = await storeRuntime.runPromise(Store)
  const project = await Effect.runPromise(store.createProject(home))
  const threadId = newId()
  await Effect.runPromise(store.createThread(project.id, threadId))
  await Effect.runPromise(store.setThreadSessionId(threadId, 'claude-original'))
  const service =
    Context.Service<Effect.Success<ReturnType<typeof createCodexAdapter>>>('test/Codex')
  function runtime() {
    const value = ManagedRuntime.make(
      Layer.effect(
        service,
        createCodexAdapter(store, {
          command: process.execPath,
          args: [join(import.meta.dir, 'fixtures/codex-peer.ts')],
          requestTimeoutMs: 1000,
          interruptGraceMs: 30,
          ...options,
        })
      ).pipe(Layer.provide(BunServices.layer))
    )
    cleanup.push(() => value.dispose())
    return value
  }
  const first = runtime()
  const agent = await first.runPromise(service)
  cleanup.unshift(async () => {
    await storeRuntime.dispose()
    rmSync(home, { recursive: true, force: true })
  })
  const events: ThreadEvent[] = []
  const emit: Emit = (event, onCommit = Effect.void) =>
    Effect.gen(function* () {
      Schema.decodeUnknownSync(EventSchema)(event)
      events.push(event)
      yield* onCommit
    })
  function start(text: string, customEmit = emit) {
    return Effect.runPromise(agent.startTurn({ threadId, turnId: newId(), text }, customEmit))
  }
  function log() {
    return readFileSync(join(home, 'peer.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  }
  return { home, store, agent, events, emit, start, log, threadId, first, runtime, service }
}

function until(events: ThreadEvent[], predicate: (event: ThreadEvent) => boolean) {
  return Effect.runPromise(
    Effect.gen(function* () {
      while (!events.some(predicate)) yield* Effect.sleep(5)
    }).pipe(Effect.timeout(2000))
  )
}

function dead(home: string) {
  const pid = Number(readFileSync(join(home, 'peer.pid'), 'utf8'))
  expect(() => process.kill(pid, 0)).toThrow()
}

test('Codex streams tools and Unicode, isolates other threads, and reaps the process', async () => {
  const f = await setup()
  const turn = await f.start('hello')
  await Effect.runPromise(turn.await)
  expect(f.events.filter((e) => e.type === 'turn.completed')).toHaveLength(1)
  expect(
    f.events
      .filter((e) => e.type === 'item.delta')
      .map((e) => e.delta)
      .join('')
  ).toBe('outputHello 🛶')
  expect(JSON.stringify(f.events)).not.toContain('Do not show')
  expect(f.events.find((e) => e.type === 'context.updated')).toMatchObject({
    usage: { usedTokens: 120, maxTokens: 200000 },
  })
  expect(await Effect.runPromise(f.store.getThreadSessionId(f.threadId))).toBe('claude-original')
  expect(await Effect.runPromise(f.store.getProviderSessionId(f.threadId, 'codex'))).toBe(
    'provider-thread'
  )
  dead(f.home)
})

test('a new adapter resumes the stored Codex session without replaying Claude history', async () => {
  const f = await setup()
  await Effect.runPromise((await f.start('first')).await)
  await f.first.dispose()
  const second = await f.runtime().runPromise(f.service)
  const turn = await Effect.runPromise(
    second.startTurn({ threadId: f.threadId, turnId: 'second', text: 'second' }, f.emit)
  )
  await Effect.runPromise(turn.await)
  expect(f.log().filter((m) => m.method === 'thread/resume')).toMatchObject([
    { params: { threadId: 'provider-thread' } },
  ])
  expect(f.log().filter((m) => m.method === 'thread/start')).toHaveLength(1)
})

for (const decision of ['allow', 'deny'] as const)
  test(`approval ${decision} is correlated, persisted before response, and single use`, async () => {
    const f = await setup()
    const turn = await f.start('approval')
    await until(f.events, (e) => e.type === 'session.status' && e.status === 'awaiting_approval')
    const approval = f.events.find((e) => e.type === 'item.started' && e.item.kind === 'approval')!
    if (approval.type !== 'item.started') throw new Error('Missing approval')
    expect(
      await Effect.runPromise(f.agent.respondToApproval('wrong', approval.item.id, decision))
    ).toBe(false)
    expect(
      await Effect.runPromise(f.agent.respondToApproval(f.threadId, approval.item.id, decision))
    ).toBe(true)
    expect(
      await Effect.runPromise(f.agent.respondToApproval(f.threadId, approval.item.id, decision))
    ).toBe(false)
    await Effect.runPromise(turn.await)
    expect(f.log().find((m) => m.id === 'approval-1')).toMatchObject({
      result: { decision: decision === 'allow' ? 'accept' : 'decline' },
    })
  })

test('question responses map question text to provider ids; unknown requests fail closed', async () => {
  const f = await setup()
  const turn = await f.start('question')
  await until(f.events, (e) => e.type === 'session.status' && e.status === 'awaiting_approval')
  const event = f.events.find((e) => e.type === 'item.started' && e.item.kind === 'question')!
  if (event.type !== 'item.started') throw new Error('Missing question')
  expect(
    await Effect.runPromise(
      f.agent.respondToQuestion(f.threadId, event.item.id, { 'Which one?': 'A' })
    )
  ).toBe(true)
  await Effect.runPromise(turn.await)
  expect(f.log().find((m) => m.id === 'approval-1')).toMatchObject({
    result: { answers: { choice: { answers: ['A'] } } },
  })
  await Effect.runPromise((await f.start('unsupported')).await)
  expect(
    f
      .log()
      .filter((m) => m.id === 'approval-1')
      .at(-1)
  ).toMatchObject({ error: { code: -32601 } })
})

test('steering commits user input after provider acceptance and rejects after completion', async () => {
  const f = await setup()
  const turn = await f.start('hold')
  await until(f.events, (e) => e.type === 'item.started')
  let committed = false
  expect(
    await Effect.runPromise(
      f.agent.steer(
        f.threadId,
        'steered',
        undefined,
        Effect.sync(() => {
          committed = true
        })
      )
    )
  ).toBe(true)
  expect(committed).toBe(true)
  await Effect.runPromise(turn.await)
  expect(f.log().find((m) => m.method === 'turn/steer')).toMatchObject({
    params: { expectedTurnId: 'provider-turn' },
  })
  expect(await Effect.runPromise(f.agent.steer(f.threadId, 'late'))).toBe(false)
})

for (const scenario of ['hold', 'ignore-interrupt', 'approval'])
  test(`interrupt settles and reaps ${scenario}`, async () => {
    const f = await setup()
    const turn = await f.start(scenario)
    await until(f.events, (e) => e.type === 'item.started')
    await Effect.runPromise(f.agent.interrupt(f.threadId, 'stopped by test'))
    await Effect.runPromise(Effect.exit(turn.await))
    expect(f.events.filter((e) => e.type === 'turn.failed')).toMatchObject([
      { error: 'stopped by test' },
    ])
    dead(f.home)
  })

for (const scenario of ['crash', 'malformed', 'start-error', 'failure'])
  test(`provider ${scenario} settles without stranding a thread`, async () => {
    const f = await setup()
    const turn = await f.start(scenario)
    const exit = await Effect.runPromise(Effect.exit(turn.await))
    if (scenario === 'failure')
      expect(f.events).toContainEqual({
        type: 'turn.failed',
        turnId: expect.any(String),
        error: 'fixture provider failure',
      })
    else expect(Exit.isFailure(exit)).toBe(true)
    await Effect.runPromise((await f.start('recovered')).await)
    dead(f.home)
  })

test('scope disposal cancels a live process and rejects duplicate starts', async () => {
  const f = await setup()
  const turn = await f.start('hold')
  await until(f.events, (e) => e.type === 'item.started')
  expect(
    Exit.isFailure(
      await Effect.runPromise(
        Effect.exit(
          f.agent.startTurn({ threadId: f.threadId, turnId: 'duplicate', text: 'hello' }, f.emit)
        )
      )
    )
  ).toBe(true)
  await f.first.dispose()
  await Effect.runPromise(Effect.exit(turn.await))
  expect(f.events.filter((e) => e.type === 'turn.failed')).toMatchObject([
    { error: 'server shutdown' },
  ])
  dead(f.home)
})

test('failed publication stops the process and allows a later turn', async () => {
  const f = await setup()
  const turn = await f.start('hello', () => Effect.fail(new AgentError('storage failed')))
  expect(Exit.isFailure(await Effect.runPromise(Effect.exit(turn.await)))).toBe(true)
  dead(f.home)
  await Effect.runPromise((await f.start('retry')).await)
})

test('translation handles completed-only items and authoritative final text without duplication', () => {
  const t = createCodexTranslator('turn')
  const events = t.translate({
    method: 'item/completed',
    params: { item: { id: 'x', type: 'reasoning', summary: ['one', 'two'] } },
  })
  expect(events).toMatchObject([
    { type: 'item.started', item: { kind: 'reasoning', text: 'one\n\ntwo' } },
    { type: 'item.completed', patch: { text: 'one\n\ntwo', streaming: false } },
  ])
  expect(
    t.translate({
      method: 'item/completed',
      params: {
        item: {
          id: 'tool',
          type: 'fileChange',
          status: 'failed',
          changes: [{ path: 'a', diff: '+b' }],
        },
      },
    })
  ).toMatchObject([{ item: { kind: 'tool_call' } }, { patch: { status: 'failed' } }])
  t.translate({
    method: 'item/started',
    params: { item: { id: 'unfinished', type: 'commandExecution', command: 'sleep 30' } },
  })
  expect(t.finish()).toMatchObject([{ type: 'item.completed', patch: { status: 'failed' } }])
  expect(t.finish()).toEqual([])
})

for (const permissionMode of ['auto', 'full_access'] as const)
  test(`Codex maps ${permissionMode}, effort and image inputs without enabling Fast mode`, async () => {
    const f = await setup()
    const turn = await Effect.runPromise(
      f.agent.startTurn(
        {
          threadId: f.threadId,
          turnId: newId(),
          text: 'hello',
          model: 'fixture-model',
          effort: 'medium',
          permissionMode,
          images: [{ mimeType: 'image/png', base64data: 'fixture' }],
        },
        f.emit
      )
    )
    await Effect.runPromise(turn.await)
    expect(f.log().find((m) => m.method === 'thread/start')).toMatchObject({
      params: {
        model: 'fixture-model',
        serviceTier: 'default',
        sandbox: permissionMode === 'full_access' ? 'danger-full-access' : 'workspace-write',
        approvalPolicy: permissionMode === 'full_access' ? 'never' : 'on-request',
      },
    })
    expect(f.log().find((m) => m.method === 'turn/start')).toMatchObject({
      params: {
        effort: 'medium',
        input: [{ type: 'text' }, { type: 'image', url: 'data:image/png;base64,fixture' }],
      },
    })
  })

test('a missing resume fails visibly without silently replacing provider history', async () => {
  const f = await setup()
  await Effect.runPromise(f.store.setProviderSessionId(f.threadId, 'codex', 'missing'))
  const turn = await f.start('hello')
  expect(Exit.isFailure(await Effect.runPromise(Effect.exit(turn.await)))).toBe(true)
  expect(f.log().some((m) => m.method === 'thread/start')).toBe(false)
  expect(await Effect.runPromise(f.store.getProviderSessionId(f.threadId, 'codex'))).toBe('missing')
})

test('concurrent start calls cannot create two processes for one thread', async () => {
  const f = await setup()
  const starts = await Promise.all([
    f.start('hold').then(
      () => true,
      () => false
    ),
    f.start('hold').then(
      () => true,
      () => false
    ),
  ])
  expect(starts.filter(Boolean)).toHaveLength(1)
  await f.first.dispose()
})

test('failed steering publication retires the accepted turn', async () => {
  const f = await setup()
  const turn = await f.start('hold')
  await until(f.events, (e) => e.type === 'item.started')
  expect(
    Exit.isFailure(
      await Effect.runPromise(
        Effect.exit(
          f.agent.steer(
            f.threadId,
            'uncommitted',
            undefined,
            Effect.fail(new AgentError('append failed'))
          )
        )
      )
    )
  ).toBe(true)
  await Effect.runPromise(Effect.exit(turn.await))
  expect(f.log().some((m) => m.method === 'turn/steer')).toBe(true)
  dead(f.home)
})

for (const afterCommit of [false, true])
  test(`approval publication failure afterCommit=${afterCommit} never contradicts a committed decision`, async () => {
    const f = await setup()
    const turn = await f.start('approval', (event, onCommit = Effect.void) =>
      Effect.gen(function* () {
        if (event.type === 'item.completed' && event.patch?.decision === 'allow') {
          if (afterCommit) yield* f.emit(event, onCommit)
          return yield* Effect.fail(new AgentError('approval storage failed'))
        }
        yield* f.emit(event, onCommit)
      })
    )
    await until(f.events, (e) => e.type === 'session.status' && e.status === 'awaiting_approval')
    const approval = f.events.find((e) => e.type === 'item.started' && e.item.kind === 'approval')!
    if (approval.type !== 'item.started') throw new Error('Missing approval')
    await Effect.runPromise(
      Effect.exit(f.agent.respondToApproval(f.threadId, approval.item.id, 'allow'))
    )
    await Effect.runPromise(Effect.exit(turn.await))
    const decisions = f.events.filter(
      (e) => e.type === 'item.completed' && e.itemId === approval.item.id
    )
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ patch: { decision: afterCommit ? 'allow' : 'deny' } })
    expect(f.events.filter((e) => e.type === 'turn.failed')).toHaveLength(1)
    expect(f.log().some((m) => m.id === 'approval-1')).toBe(false)
    dead(f.home)
  })

test('initialization timeout fails and reaps a nonresponsive process', async () => {
  const f = await setup({
    args: [join(import.meta.dir, 'fixtures/codex-peer.ts'), 'silent-init'],
    requestTimeoutMs: 80,
  })
  const turn = await f.start('hello')
  expect(Exit.isFailure(await Effect.runPromise(Effect.exit(turn.await)))).toBe(true)
  dead(f.home)
})

test('missing CLI fails with an actionable launch error', async () => {
  const f = await setup({ command: '/nonexistent/jetty-codex-cli' })
  const turn = await f.start('hello')
  await expect(Effect.runPromise(turn.await)).rejects.toThrow('Unable to launch Codex')
})
