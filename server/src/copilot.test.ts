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
import { createCopilotAdapter, type CopilotOptions } from './copilot'
import { discoverCopilotModels } from './copilot-models'
import { createCopilotPrompt } from './copilot-prompt'
import { databaseLayer } from './db'
import { createMcpSessions } from './mcp-sessions'
import { Store, storeLayer } from './store'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

test('discovers model-specific reasoning options without running prompts', async () => {
  const f = await setup()
  const models = await Effect.runPromise(
    discoverCopilotModels(f.home, {
      command: process.execPath,
      args: [join(import.meta.dir, 'fixtures/copilot-peer.ts')],
    }).pipe(Effect.provide(BunServices.layer))
  )
  expect(models).toMatchObject([
    { provider: 'copilot', id: 'gpt-5-mini', efforts: ['low', 'medium', 'high'] },
    { provider: 'copilot', id: 'slow-model', efforts: ['low', 'medium', 'high', 'xhigh'] },
  ])
  expect(f.log().some((m) => m.method === 'session/prompt')).toBe(false)
})

test('uses ACP config for model, effort and full access, with inline images', async () => {
  const f = await setup()
  const turn = await Effect.runPromise(
    f.agent.startTurn(
      {
        threadId: f.threadId,
        turnId: newId(),
        text: 'image',
        model: 'gpt-5-mini',
        effort: 'high',
        permissionMode: 'full_access',
        images: [{ mimeType: 'image/png', base64data: 'aGVsbG8=' }],
      },
      f.emit
    )
  )
  await Effect.runPromise(turn.await)
  expect(
    f
      .log()
      .filter((m) => m.method === 'session/set_config_option')
      .map((m) => m.params)
  ).toContainEqual({ sessionId: 'copilot-session', configId: 'reasoning_effort', value: 'high' })
  expect(
    f
      .log()
      .filter((m) => m.method === 'session/set_config_option')
      .map((m) => m.params)
  ).toContainEqual({ sessionId: 'copilot-session', configId: 'allow_all', value: 'on' })
  expect(f.log().find((m) => m.method === 'session/prompt').params.prompt[1]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: 'aGVsbG8=',
  })
})

test('edit approvals keep diffs and correlate the tool id before the tool arrives', async () => {
  const f = await setup()
  const turn = await f.start('edit approval')
  await until(f.events, (e) => e.type === 'item.started' && e.item.kind === 'approval')
  const event = f.events.find((e) => e.type === 'item.started' && e.item.kind === 'approval')!
  expect(event).toMatchObject({
    item: {
      toolName: 'Edit',
      changes: [{ path: 'marker', diff: expect.stringContaining('-before') }],
      toolCallId: expect.any(String),
      always: { scope: 'session' },
    },
  })
  if (event.type !== 'item.started') throw new Error('Missing approval')
  await Effect.runPromise(f.agent.respondToApproval(f.threadId, event.item.id, 'allow'))
  await Effect.runPromise(turn.await)
})

test('edit approvals also accept ACP content diffs', async () => {
  const f = await setup()
  const turn = await f.start('edit content approval')
  await until(f.events, (event) => event.type === 'item.started' && event.item.kind === 'approval')
  const event = f.events.find(
    (event) => event.type === 'item.started' && event.item.kind === 'approval'
  )!
  expect(event).toMatchObject({
    item: { changes: [{ path: 'marker', before: 'before', after: 'after' }] },
  })
  if (event.type !== 'item.started') throw new Error('Missing approval')
  await Effect.runPromise(f.agent.respondToApproval(f.threadId, event.item.id, 'allow'))
  await Effect.runPromise(turn.await)
})

test('passes Jetty MCP into sessions and approves self tools without a card', async () => {
  const mcp = createMcpSessions()
  mcp.setUrl('http://localhost:1234/mcp')
  const f = await setup({ mcp })
  await Effect.runPromise((await f.start('self tool')).await)
  const servers = f.log().find((m) => m.method === 'session/new').params.mcpServers
  expect(servers).toMatchObject([
    {
      type: 'http',
      name: 'jetty',
      url: 'http://localhost:1234/mcp',
      headers: [{ name: 'Authorization', value: expect.stringContaining('Bearer ') }],
    },
  ])
  expect(f.events.some((e) => e.type === 'item.started' && e.item.kind === 'approval')).toBe(false)
  const state = f.events.reduce(
    (state, event, i) => applyEvent(state, { seq: i + 1, ts: Date.now(), event }),
    emptyThread
  )
  expect(state.items.find((item) => item.kind === 'tool_call')).toMatchObject({
    toolName: 'mcp__jetty__list_models',
    status: 'succeeded',
  })
})

test('MCP permissions identify a tool whose initial title is a description', async () => {
  const f = await setup()
  const turn = await f.start('custom mcp')
  await Effect.runPromise(turn.await)
  expect(
    f.events.some((event) => event.type === 'item.started' && event.item.kind === 'approval')
  ).toBe(false)
  const state = f.events.reduce(
    (state, event, i) => applyEvent(state, { seq: i + 1, ts: Date.now(), event }),
    emptyThread
  )
  expect(state.items.find((item) => item.kind === 'tool_call')).toMatchObject({
    toolName: 'mcp__jetty__create_thread',
    status: 'succeeded',
  })
})

for (const failed of [false, true])
  test(`manual compaction failure=${failed}`, async () => {
    const f = await setup({
      env: { ...process.env, COPILOT_PEER_COMPACT_FAILURE: failed ? '1' : '0' },
    })
    const turn = await Effect.runPromise(
      f.agent.startTurn({ threadId: f.threadId, turnId: newId(), text: '', compact: true }, f.emit)
    )
    await Effect.runPromise(turn.await)
    expect(f.log().find((m) => m.method === 'session/prompt').params.prompt).toEqual([
      { type: 'text', text: '/compact' },
    ])
    const state = f.events.reduce(
      (state, event, i) => applyEvent(state, { seq: i + 1, ts: Date.now(), event }),
      emptyThread
    )
    expect(state.items.find((item) => item.kind === 'compaction')).toMatchObject({
      status: failed ? 'failed' : 'completed',
    })
    expect(
      f.events.filter((e) => e.type === (failed ? 'turn.failed' : 'turn.completed'))
    ).toHaveLength(1)
  })

test('signed-out sessions explain how to log in', async () => {
  const f = await setup({ env: { ...process.env, COPILOT_PEER_SIGNED_OUT: '1' } })
  await expect(Effect.runPromise((await f.start('hello')).await)).rejects.toThrow('copilot login')
})

test('title generation uses the selected Copilot model and streamed response', async () => {
  const f = await setup()
  const prompt = await Effect.runPromise(
    createCopilotPrompt({
      command: process.execPath,
      args: [join(import.meta.dir, 'fixtures/copilot-peer.ts')],
      env: { ...process.env, COPILOT_PEER_CWD: f.home },
    }).pipe(Effect.provide(BunServices.layer))
  )
  expect(
    await Effect.runPromise(
      prompt(
        {
          provider: 'copilot',
          id: 'gpt-5-mini',
          name: 'GPT-5 mini',
          efforts: ['low'],
          fast: false,
          autoMode: true,
        },
        'low',
        false,
        'Write a title',
        'hello'
      )
    )
  ).toBe('Hello 🛶')
  expect(
    f
      .log()
      .some(
        (m) =>
          m.method === 'session/set_config_option' &&
          m.params.configId === 'model' &&
          m.params.value === 'gpt-5-mini'
      )
  ).toBe(true)
})

async function setup(options: CopilotOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jetty-copilot-'))
  const storeRuntime = ManagedRuntime.make(
    storeLayer.pipe(Layer.provide(databaseLayer(home)), Layer.provide(BunServices.layer))
  )
  const store = await storeRuntime.runPromise(Store)
  const project = await Effect.runPromise(store.createProject(home))
  const threadId = newId()
  await Effect.runPromise(store.createThread(project.id, threadId))
  await Effect.runPromise(store.setThreadSessionId(threadId, 'claude-original'))
  const service =
    Context.Service<Effect.Success<ReturnType<typeof createCopilotAdapter>>>('test/Copilot')
  function runtime() {
    const value = ManagedRuntime.make(
      Layer.effect(
        service,
        createCopilotAdapter(store, {
          command: process.execPath,
          args: [join(import.meta.dir, 'fixtures/copilot-peer.ts')],
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
  throw new Error('Copilot peer is still alive')
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
  expect(state.items.filter((item) => item.kind === 'tool_call')).toMatchObject([
    { toolName: 'Bash', status: 'succeeded', output: 'marker output' },
    {
      toolName: 'Edit',
      status: 'succeeded',
      output: expect.stringContaining('+hello'),
      fileChange: { path: 'marker', additions: 1, deletions: 0 },
      input: { file_path: 'marker', content: 'hello', locations: [{ path: 'marker', line: 1 }] },
    },
    { toolName: 'update_plan', input: { todos: [{ content: 'Ship it' }] } },
  ])
  await until(f.events, (e) => e.type === 'context.updated')
  expect(f.events.find((e) => e.type === 'context.updated')).toMatchObject({
    usage: { usedTokens: 17827, maxTokens: 128000 },
  })
  expect(await Effect.runPromise(f.store.getProviderSessionId(f.threadId, 'copilot'))).toBe(
    'copilot-session'
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

for (const decision of ['allow', 'always', 'deny'] as const)
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
    expect(f.log().find((m) => m.id === 0 && m.result).result).toEqual({
      outcome: {
        outcome: 'selected',
        optionId:
          decision === 'deny' ? 'no-once' : decision === 'always' ? 'yes-always' : 'yes-once',
      },
    })
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

test('stop while a steer waits on its cancellation ends the turn without prompting the steer', async () => {
  const f = await setup()
  const turn = await f.start('steer')
  await until(f.events, (e) => e.type === 'turn.started')
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(await Effect.runPromise(f.agent.steer(f.threadId, 'new'))).toBe(true)
  await Effect.runPromise(f.agent.interrupt(f.threadId))
  await Effect.runPromise(turn.await).catch(() => {})
  expect(f.events.filter((e) => e.type === 'turn.failed')).toHaveLength(1)
  expect(f.log().filter((m) => m.method === 'session/prompt')).toHaveLength(1)
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

test('stop leaves an open tool unsettled so it reads as stopped, not failed', async () => {
  const f = await setup()
  const turn = await f.start('slow tool')
  await until(f.events, (e) => e.type === 'item.started' && e.item.kind === 'tool_call')
  await Effect.runPromise(f.agent.interrupt(f.threadId))
  await Effect.runPromise(turn.await).catch(() => {})
  const state = f.events.reduce(
    (state, event, index) => applyEvent(state, { seq: index + 1, ts: Date.now(), event }),
    emptyThread
  )
  expect(state.items.find((item) => item.kind === 'tool_call')).toMatchObject({
    status: 'running',
    completedAt: expect.any(Number),
  })
  expect(state.lastTurnOutcome).toBe('interrupted')
})

test('process crashes reject the turn and release admission', async () => {
  const f = await setup()
  await expect(Effect.runPromise((await f.start('crash')).await)).rejects.toThrow()
  await Effect.runPromise((await f.start('next')).await)
  expect(() =>
    process.kill(Number(readFileSync(join(f.home, 'peer.pid'), 'utf8')), 0)
  ).not.toThrow()
})

test('idle expiry cannot retire a warm session while a send changes its model', async () => {
  const f = await setup({ ttlMs: 50 })
  await Effect.runPromise((await f.start('hello')).await)
  const pid = readFileSync(join(f.home, 'peer.pid'), 'utf8')
  const turn = await Effect.runPromise(
    f.agent.startTurn(
      { threadId: f.threadId, turnId: newId(), text: 'again', model: 'slow-model' },
      f.emit
    )
  )
  await Effect.runPromise(turn.await)
  expect(f.events.filter((e) => e.type === 'turn.completed')).toHaveLength(2)
  expect(readFileSync(join(f.home, 'peer.pid'), 'utf8')).toBe(pid)
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

test('scope disposal cancels running Copilot and duplicate starts fail', async () => {
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
    expect(f.log().some((m) => m.id === 0 && m.result)).toBe(false)
    dead(f.home)
  })
