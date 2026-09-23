import type { ThreadEvent } from '@jetty/shared/events'

import { BunServices } from '@effect/platform-bun'
import { ThreadEvent as EventSchema } from '@jetty/shared/events'
import { applyEvent, emptyThread } from '@jetty/shared/reducer'
import { newId } from '@jetty/shared/wire'
import { afterEach, expect, test } from 'bun:test'
import { Context, Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentError, type Emit } from './agent'
import { databaseLayer } from './db'
import { createGrokAdapter, grokArgs, type GrokOptions } from './grok'
import { Store, storeLayer } from './store'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function setup(options: GrokOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jetty-grok-'))
  const storeRuntime = ManagedRuntime.make(
    storeLayer.pipe(Layer.provide(databaseLayer(home)), Layer.provide(BunServices.layer))
  )
  const store = await storeRuntime.runPromise(Store)
  const project = await Effect.runPromise(store.createProject(home))
  const threadId = newId()
  await Effect.runPromise(store.createThread(project.id, threadId))
  await Effect.runPromise(store.setThreadSessionId(threadId, 'claude-original'))
  const service = Context.Service<Effect.Success<ReturnType<typeof createGrokAdapter>>>('test/Grok')
  function runtime() {
    const value = ManagedRuntime.make(
      Layer.effect(
        service,
        createGrokAdapter(store, {
          command: process.execPath,
          args: [join(import.meta.dir, 'fixtures/grok-peer.ts')],
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

async function dead(home: string) {
  const pid = Number(readFileSync(join(home, 'peer.pid'), 'utf8'))
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Grok peer is still alive')
}

test('streams ACP, preserves partial tool output, filters replay, stays warm, and resumes', async () => {
  const f = await setup()
  await Effect.runPromise((await f.start('hello')).await)
  expect(f.events.filter((e) => e.type === 'turn.completed')).toHaveLength(1)
  expect(JSON.stringify(f.events)).not.toContain('old replay')
  expect(JSON.stringify(f.events)).not.toContain('foreign')
  expect(JSON.stringify(f.events)).toContain('Hello 🛶')
  const state = f.events.reduce(
    (state, event, index) => applyEvent(state, { seq: index + 1, ts: Date.now(), event }),
    emptyThread
  )
  expect(state.items.find((item) => item.kind === 'tool_call')).toMatchObject({
    status: 'succeeded',
    output: 'marker output',
  })
  expect(await Effect.runPromise(f.store.getProviderSessionId(f.threadId, 'grok'))).toBe(
    'grok-session'
  )
  expect(await Effect.runPromise(f.store.getThreadSessionId(f.threadId))).toBe('claude-original')
  const pid = Number(readFileSync(join(f.home, 'peer.pid'), 'utf8'))
  expect(() => process.kill(pid, 0)).not.toThrow()
  await Effect.runPromise((await f.start('again')).await)
  expect(f.log().filter((m) => m.method === 'session/load')).toHaveLength(0)
  await f.first.dispose()
  await dead(f.home)
  const restarted = f.runtime()
  const agent = await restarted.runPromise(f.service)
  await Effect.runPromise(
    (
      await Effect.runPromise(
        agent.startTurn({ threadId: f.threadId, turnId: newId(), text: 'again' }, f.emit)
      )
    ).await
  )
  expect(f.log().filter((m) => m.method === 'session/load')).toHaveLength(1)
})

for (const decision of ['allow', 'deny'] as const)
  test('permission ' + decision, async () => {
    const f = await setup()
    const turn = await f.start('approval')
    await until(f.events, (e) => e.type === 'item.started' && e.item.kind === 'approval')
    const event = f.events.find((e) => e.type === 'item.started' && e.item.kind === 'approval')!
    if (event.type !== 'item.started') throw new Error('missing')
    expect(
      await Effect.runPromise(f.agent.respondToApproval(f.threadId, event.item.id, decision))
    ).toBe(true)
    expect(
      await Effect.runPromise(f.agent.respondToApproval(f.threadId, event.item.id, decision))
    ).toBe(false)
    await Effect.runPromise(turn.await)
    expect(f.log().find((m) => m.id === 'approval' && m.result).result).toEqual({
      outcome: { outcome: 'selected', optionId: decision === 'allow' ? 'yes-once' : 'no-once' },
    })
  })

test('questions use xAI answer arrays', async () => {
  const f = await setup()
  const turn = await f.start('question')
  await until(f.events, (e) => e.type === 'item.started' && e.item.kind === 'question')
  const event = f.events.find((e) => e.type === 'item.started' && e.item.kind === 'question')!
  if (event.type !== 'item.started') throw new Error('missing')
  await Effect.runPromise(f.agent.respondToQuestion(f.threadId, event.item.id, { 'Which?': 'A,B' }))
  await Effect.runPromise(turn.await)
  expect(f.log().find((m) => m.id === 'question' && m.result).result).toEqual({
    outcome: 'accepted',
    answers: { q1: ['A', 'B'] },
  })
})

test('plan gates are abandoned without asking for approval', async () => {
  const f = await setup()
  await Effect.runPromise((await f.start('plan')).await)
  expect(f.log().find((m) => m.id === 'plan' && m.result).result.outcome).toBe('abandoned')
  expect(f.events.some((e) => e.type === 'item.started' && e.item.kind === 'approval')).toBe(false)
})

for (const mode of ['extension', 'rate_limit'])
  test(mode + ' completion', async () => {
    const f = await setup()
    await Effect.runPromise((await f.start(mode)).await)
    expect(
      f.events.filter((e) => e.type === (mode === 'extension' ? 'turn.completed' : 'turn.failed'))
    ).toHaveLength(1)
    expect(() =>
      process.kill(Number(readFileSync(join(f.home, 'peer.pid'), 'utf8')), 0)
    ).not.toThrow()
  })

test('steering cancels then prompts, ignores old completion, and preserves one logical turn', async () => {
  const f = await setup()
  const turn = await f.start('steer')
  await until(f.events, (e) => e.type === 'turn.started')
  await new Promise((resolve) => setTimeout(resolve, 20))
  let accepted = false
  expect(
    await Effect.runPromise(
      f.agent.steer(
        f.threadId,
        'new',
        undefined,
        Effect.sync(() => {
          accepted = true
        })
      )
    )
  ).toBe(true)
  expect(accepted).toBe(true)
  await Effect.runPromise(turn.await)
  expect(f.events.filter((e) => e.type === 'turn.completed')).toHaveLength(1)
  expect(f.events.filter((e) => e.type === 'turn.failed')).toHaveLength(0)
  expect(f.log().filter((m) => m.method === 'session/prompt')).toHaveLength(2)
})

test('interrupt settles approval items and preserves the warm process', async () => {
  const f = await setup()
  const turn = await f.start('approval')
  await until(f.events, (e) => e.type === 'item.started' && e.item.kind === 'approval')
  await Effect.runPromise(f.agent.interrupt(f.threadId))
  await Effect.runPromise(turn.await).catch(() => {})
  expect(f.events.some((e) => e.type === 'item.completed' && e.patch?.decision === 'deny')).toBe(
    true
  )
  expect(f.events.filter((e) => e.type === 'turn.failed')).toHaveLength(1)
  expect(() =>
    process.kill(Number(readFileSync(join(f.home, 'peer.pid'), 'utf8')), 0)
  ).not.toThrow()
})

test('process crashes reject the turn and release admission', async () => {
  const f = await setup()
  await expect(Effect.runPromise((await f.start('crash')).await)).rejects.toThrow()
  await Effect.runPromise((await f.start('next')).await)
  expect(() =>
    process.kill(Number(readFileSync(join(f.home, 'peer.pid'), 'utf8')), 0)
  ).not.toThrow()
})

test('permission modes disable plans and use separate sandbox profiles', () => {
  expect(grokArgs({ threadId: 't', turnId: 't', text: '' })).toEqual([
    '--no-plan',
    '--permission-mode',
    'auto',
    '--sandbox',
    'workspace',
    'agent',
    '--no-leader',
    'stdio',
  ])
  expect(
    grokArgs({ threadId: 't', turnId: 't', text: '', permissionMode: 'full_access' })
  ).toContain('bypassPermissions')
  expect(
    grokArgs({ threadId: 't', turnId: 't', text: '', permissionMode: 'full_access' })
  ).toContain('off')
})

test('model alias uses advertised model, effort and images use ACP fields', async () => {
  const f = await setup()
  const turn = await Effect.runPromise(
    f.agent.startTurn(
      {
        threadId: f.threadId,
        turnId: newId(),
        text: 'image',
        model: 'grok-build',
        effort: 'high',
        images: [{ mimeType: 'image/png', base64data: 'aGVsbG8=' }],
      },
      f.emit
    )
  )
  await Effect.runPromise(turn.await)
  expect(f.log().find((m) => m.method === 'session/set_model').params).toMatchObject({
    modelId: 'real-model',
    _meta: { reasoningEffort: 'high' },
  })
  expect(f.log().find((m) => m.method === 'session/prompt').params.prompt[1]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: 'aGVsbG8=',
  })
})

test('steering timeout reaps an unresponsive provider', async () => {
  const f = await setup()
  const turn = await f.start('hang')
  await until(f.events, (e) => e.type === 'item.delta')
  expect(await Effect.runPromise(f.agent.steer(f.threadId, 'next'))).toBe(true)
  await Effect.runPromise(turn.await).catch(() => {})
  expect(f.events.filter((e) => e.type === 'turn.failed')).toHaveLength(1)
  dead(f.home)
})

test('failed steering publication never sends uncommitted input', async () => {
  const f = await setup()
  const turn = await f.start('steer')
  await until(f.events, (e) => e.type === 'item.delta')
  await expect(
    Effect.runPromise(
      f.agent.steer(f.threadId, 'lost', undefined, Effect.fail(new AgentError('commit failed')))
    )
  ).rejects.toThrow('commit failed')
  await Effect.runPromise(turn.await).catch(() => {})
  expect(f.log().filter((m) => m.method === 'session/prompt')).toHaveLength(1)
  dead(f.home)
})

test('scope disposal cancels running Grok and duplicate starts fail', async () => {
  const f = await setup()
  const turn = await f.start('hang')
  await until(f.events, (e) => e.type === 'item.delta')
  await expect(f.start('duplicate')).rejects.toThrow('Turn already active')
  await f.first.dispose()
  await Effect.runPromise(turn.await).catch(() => {})
  expect(f.events.filter((e) => e.type === 'turn.failed')).toHaveLength(1)
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
