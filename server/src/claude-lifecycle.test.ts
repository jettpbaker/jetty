import type {
  Options,
  Query,
  SDKControlGetUsageResponse,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { ThreadEvent } from '@jetty/shared/events'

import { BunServices } from '@effect/platform-bun'
import { newId } from '@jetty/shared/wire'
import { afterEach, describe, expect, test } from 'bun:test'
import { Context, Deferred, Effect, Layer, ManagedRuntime, Queue } from 'effect'
import { TestClock } from 'effect/testing'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentError, type AgentHooks, type Emit } from './agent'
import { createAttachments } from './attachments'
import { botInstructions, commitBotHome, createBotHome } from './bot-home'
import { BOT_PROMPT_FILES } from './bot-prompt'
import { createClaudeAdapter, type ClaudeOptions, type QueryFactory } from './claude'
import { databaseLayer } from './db'
import { createHub } from './hub'
import { jettyInstructions } from './jetty-instructions'
import { createMcpHandler } from './mcp'
import { createMcpSessions } from './mcp-sessions'
import { createOrchestrator } from './orchestrator'
import { createPullRequestLinks, createPullRequests } from './pull-requests'
import { Store, storeLayer } from './store'

function fakeQueries(readUsage?: () => Promise<SDKControlGetUsageResponse>) {
  const queries: ReturnType<typeof make>[] = []
  function make(options: Options, prompt: AsyncIterable<SDKUserMessage>) {
    const pending: SDKMessage[] = []
    let waiting:
      | { resolve: (value: IteratorResult<SDKMessage>) => void; reject: (error: Error) => void }
      | undefined
    let closed = false
    let closeCount = 0
    let interrupts = 0
    let failure: Error | undefined
    let rejectControls = false
    const controls: unknown[][] = []
    function control(...call: unknown[]) {
      controls.push(call)
      return rejectControls ? Promise.reject(new Error('control failed')) : Promise.resolve()
    }
    const iterator = {
      next(): Promise<IteratorResult<SDKMessage>> {
        const message = pending.shift()
        if (message) return Promise.resolve({ value: message, done: false })
        if (closed) return Promise.resolve({ value: undefined, done: true })
        if (failure) return Promise.reject(failure)
        return new Promise((resolve, reject) => {
          waiting = { resolve, reject }
        })
      },
      return(): Promise<IteratorResult<SDKMessage>> {
        return iterator.next().then(() => ({ value: undefined, done: true }))
      },
      [Symbol.asyncIterator]() {
        return iterator
      },
    }
    const value = {
      options,
      input: prompt[Symbol.asyncIterator](),
      get closed() {
        return closed
      },
      get closeCount() {
        return closeCount
      },
      get interrupts() {
        return interrupts
      },
      controls,
      rejectControls() {
        rejectControls = true
      },
      push(message: object) {
        if (waiting) {
          const waiter = waiting
          waiting = undefined
          waiter.resolve({ value: message as SDKMessage, done: false })
        } else pending.push(message as SDKMessage)
      },
      fail(error: Error) {
        failure = error
        const waiter = waiting
        waiting = undefined
        waiter?.reject(error)
      },
      query: {
        [Symbol.asyncIterator]() {
          return iterator
        },
        close() {
          closeCount++
          closed = true
          const waiter = waiting
          waiting = undefined
          waiter?.resolve({ value: undefined, done: true })
        },
        async interrupt() {
          interrupts++
        },
        stopTask: (taskId: string) => control('stopTask', taskId),
        setModel: (model?: string) => control('setModel', model),
        applyFlagSettings: (settings: object) => control('applyFlagSettings', settings),
        setPermissionMode: (mode: string) => control('setPermissionMode', mode),
        async getContextUsage() {
          return { maxTokens: 0, rawMaxTokens: 0 }
        },
        async usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET() {
          return readUsage ? readUsage() : { rate_limits_available: false }
        },
      } as unknown as Query,
    }
    return value
  }
  const factory: QueryFactory = ({ options, prompt }) => {
    const fake = make(options ?? {}, prompt as AsyncIterable<SDKUserMessage>)
    queries.push(fake)
    return fake.query
  }
  return { queries, factory }
}

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function setup(
  options: ClaudeOptions & { bot?: boolean } = {},
  hooks: AgentHooks = {},
  beforeEmit: Emit = () => Effect.void
) {
  const home = mkdtempSync(join(tmpdir(), 'jetty-claude-lifecycle-'))
  const fake = fakeQueries()
  const events: ThreadEvent[] = []
  const service = Context.Service<Effect.Success<ReturnType<typeof make>>>('test/Claude')
  function make() {
    return Effect.gen(function* () {
      const context = yield* Layer.build(storeLayer.pipe(Layer.provide(databaseLayer(home))))
      const store = Context.get(context, Store)
      const project = yield* store.createProject(home)
      const id = newId()
      const botHome = join(home, 'bots', id)
      if (options.bot) {
        yield* Effect.promise(() => createBotHome(botHome))
        yield* store.createBotRecord(
          {
            id,
            name: 'Verify',
            shape: 'circle',
            color: 'coral',
            provider: 'claude',
            model: 'sonnet',
            fast: false,
            projectId: project.id,
            permissionMode: 'auto',
          },
          botHome
        )
      }
      const thread = options.bot
        ? yield* store.requireThread(id)
        : yield* store.createThread(project.id, id)
      const notifications = yield* Queue.make<ThreadEvent>()
      const attachments = yield* createAttachments(home)
      const agent = yield* createClaudeAdapter(store, hooks, {
        query: fake.factory,
        ttlMs: 1000,
        interruptGraceMs: 100,
        ...options,
      })
      function emit(event: ThreadEvent, onCommit = Effect.void) {
        return Effect.gen(function* () {
          yield* beforeEmit(event)
          events.push(event)
          yield* store.appendEvent(thread.id, event).pipe(
            Effect.andThen(onCommit),
            Effect.uninterruptible,
            Effect.mapError((error) => new AgentError(error.message))
          )
          yield* Queue.offer(notifications, event)
        })
      }
      function next(type: ThreadEvent['type']) {
        return Effect.gen(function* () {
          while (true) {
            const event = yield* Queue.take(notifications)
            if (event.type === type) return event
          }
        })
      }
      const hub = createHub()
      const orch = yield* createOrchestrator({ store, agent, hub, attachments })
      const sessions = createMcpSessions()
      sessions.setUrl('http://127.0.0.1/mcp')
      const binding = yield* sessions.open({ threadId: thread.id, provider: 'claude' })
      const links = createPullRequestLinks(
        store,
        hub,
        createPullRequests(store, hub),
        yield* Effect.scope
      )
      const handle = yield* createMcpHandler(
        sessions,
        store,
        orch,
        attachments,
        () => null,
        links,
        () => Effect.void
      )
      async function callMedia(name: string, file: string) {
        const response = await handle(
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
                name,
                arguments: name === 'send_images' ? { paths: [file] } : { path: file },
              },
            }),
          })
        )
        const body = (await response.json()) as { result: { isError?: boolean } }
        return body.result
      }
      return { agent, attachments, store, thread, botHome, emit, next, orch, callMedia }
    })
  }
  const runtime = ManagedRuntime.make(
    Layer.effect(service, make()).pipe(
      Layer.provide(BunServices.layer),
      Layer.provideMerge(TestClock.layer())
    )
  )
  cleanup.push(async () => {
    await runtime.dispose()
    rmSync(home, { recursive: true, force: true })
  })
  const fixture = await runtime.runPromise(service)
  function start(
    turnId = newId(),
    extra: Partial<Parameters<typeof fixture.agent.startTurn>[0]> = {}
  ) {
    return runtime.runPromise(
      fixture.agent.startTurn(
        { threadId: fixture.thread.id, turnId, text: 'hello', ...extra },
        fixture.emit
      )
    )
  }
  return { ...fixture, ...fake, home, events, runtime, start }
}

type DecisionKind = 'approval' | 'question'
type Fixture = Awaited<ReturnType<typeof setup>>

function askDecision(f: Fixture, kind: DecisionKind) {
  return Promise.resolve(
    f.queries[0]!.options.canUseTool!(
      kind === 'approval' ? 'Bash' : 'AskUserQuestion',
      kind === 'approval'
        ? { command: 'true' }
        : {
            questions: [
              {
                question: 'Which?',
                header: 'Choice',
                options: [
                  { label: 'A', description: 'First' },
                  { label: 'B', description: 'Second' },
                ],
                multiSelect: false,
              },
            ],
          },
      { signal: new AbortController().signal, toolUseID: kind, requestId: kind }
    )
  )
}

async function pendingDecision(f: Fixture, kind: DecisionKind) {
  let settled = false
  const callback = askDecision(f, kind).then((result) => {
    settled = true
    return result
  })
  await f.runtime.runPromise(f.next('session.status'))
  const item = f.events.find((event) => event.type === 'item.started' && event.item.kind === kind)
  if (!item || item.type !== 'item.started') throw new Error(`Missing ${kind}`)
  const itemId = item.item.id
  function respond(decision: 'allow' | 'deny') {
    return f.runtime.runPromise(
      kind === 'approval'
        ? f.agent.respondToApproval(f.thread.id, itemId, decision)
        : f.agent.respondToQuestion(f.thread.id, itemId, {
            'Which?': decision === 'allow' ? 'A' : 'B',
          })
    )
  }
  return {
    callback,
    respond,
    itemId,
    get settled() {
      return settled
    },
  }
}

describe('scoped Claude sessions', () => {
  test('bot Allow always owns its rules, keeps defaults and never sends provider suggestions', async () => {
    const f = await setup({ bot: true })
    const saved = { id: newId(), text: 'Verify may run checks', createdAt: 0 }
    await f.runtime.runPromise(f.store.setBotAllowRules(f.thread.id, [saved]))
    await f.start()
    const q = f.queries[0]!
    expect(q.options.settings).toEqual({ autoMode: { allow: ['$defaults', saved.text] } })
    const rule = 'Verify may close the two v16 issues with `gh issue close`'
    const input = {
      command: 'gh issue close 212 214 --reason completed',
      description: 'Close the two v16 issues',
    }
    const callback = Promise.resolve(
      q.options.canUseTool!('Bash', input, {
        signal: new AbortController().signal,
        toolUseID: 'close',
        requestId: 'close',
        suggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: 'gh issue close *' }],
            behavior: 'allow',
            destination: 'projectSettings',
          },
        ],
      })
    )
    await f.runtime.runPromise(f.next('session.status'))
    const started = f.events.find(
      (event) => event.type === 'item.started' && event.item.kind === 'approval'
    )
    if (started?.type !== 'item.started' || started.item.kind !== 'approval')
      throw new Error('Missing approval')
    expect(started.item.title).toBe(input.description)
    expect(
      await f.runtime.runPromise(f.agent.respondToApproval(f.thread.id, started.item.id, 'always'))
    ).toBe(true)
    expect(await callback).toEqual({ behavior: 'allow', updatedInput: input })
    const bot = await f.runtime.runPromise(f.store.getBot(f.thread.id))
    expect(bot?.allowRules?.[1]?.source).toBe(input.description)
    expect(bot?.allowRules?.[1]?.text).toBe('Close the two v16 issues with `gh issue close`')
    expect(q.controls).toContainEqual([
      'applyFlagSettings',
      { autoMode: { allow: ['$defaults', saved.text, rule] } },
    ])
    await f.runtime.runPromise(f.orch.setBotAllowRules(f.thread.id, []))
    expect(q.controls.at(-1)).toEqual(['applyFlagSettings', { autoMode: { allow: ['$defaults'] } }])
    expect((await f.runtime.runPromise(f.store.getBot(f.thread.id)))?.allowRules).toEqual([])
    expect(await f.runtime.runPromise(f.store.getPermissionMode(f.thread.id))).toBe('auto')
  })

  test('bot Agent max refusal holds in the permission callback and Full access hook', async () => {
    const f = await setup({ bot: true })
    await f.start(newId(), { permissionMode: 'full_access' })
    const q = f.queries[0]!
    const refused = { behavior: 'deny' as const, message: "max isn't available to bots; use xhigh" }
    for (const tool of ['Agent', 'Task']) {
      expect(
        await q.options.canUseTool!(
          tool,
          { effort: 'max' },
          { signal: new AbortController().signal, toolUseID: tool, requestId: tool }
        )
      ).toEqual(refused)
      const hook = q.options.hooks!.PreToolUse![0]!.hooks[0]!
      const result = await hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: { effort: 'max' },
          tool_use_id: tool,
          session_id: 'bot',
          transcript_path: '',
          cwd: f.botHome,
        },
        tool,
        { signal: new AbortController().signal }
      )
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: refused.message,
        },
      })
    }
  })

  test('bot instructions own CLAUDE.md, import files in order and only rewrite changed content', async () => {
    const f = await setup({ bot: true })
    const bot = await f.runtime.runPromise(f.store.getBot(f.thread.id))
    if (!bot) throw new Error('Missing bot')
    const projects = await f.runtime.runPromise(f.store.listProjects())
    const behaviours = await f.runtime.runPromise(f.store.getAgentBehaviours())
    const folder = join(f.botHome, '.jetty', 'instructions')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'stale.md'), 'old')
    writeFileSync(join(f.botHome, 'CLAUDE.md'), '@../preferences.md\nold instructions\n')
    writeFileSync(join(f.botHome, '.gitignore'), 'files/cache')
    const render = () => botInstructions(bot, projects, behaviours, f.botHome)
    const hash = await render()
    const names = ['jetty.md', ...BOT_PROMPT_FILES, 'preferences.md']
    expect(readFileSync(join(f.botHome, 'CLAUDE.md'), 'utf8')).toBe(
      [...names.map((name) => `@.jetty/instructions/${name}`), '@brief.md', '@index.md', ''].join(
        '\n'
      )
    )
    expect(readdirSync(folder).sort()).toEqual([...names].sort())
    expect(readFileSync(join(f.botHome, '.gitignore'), 'utf8')).toBe('files/cache\n.jetty/\n')
    expect(readFileSync(join(folder, 'jetty.md'), 'utf8')).not.toContain('mark_ready_for_review')
    expect(readFileSync(join(folder, 'you.md'), 'utf8')).toContain("You're Verify, a bot in Jetty.")
    expect(readFileSync(join(folder, 'you.md'), 'utf8')).toContain(`Yours is ${projects[0]!.title}`)
    expect(readFileSync(join(folder, 'talking.md'), 'utf8')).toContain(
      'Some of your own actions need'
    )
    expect(readFileSync(join(folder, 'workers.md'), 'utf8')).not.toContain('Workers start in Auto.')
    expect(readFileSync(join(folder, 'preferences.md'), 'utf8')).toContain('(none yet)')
    expect(names.map((name) => readFileSync(join(folder, name), 'utf8')).join('')).not.toMatch(
      /\{(?:name|user|home|bots|project|questionTool|if auto|if full access)\}/
    )
    for (const name of [...names, '../../CLAUDE.md'])
      utimesSync(join(folder, name), new Date(1000), new Date(1000))
    writeFileSync(join(f.botHome, 'brief.md'), 'A new job')
    writeFileSync(join(f.botHome, 'index.md'), 'A new page')
    expect(await render()).toBe(hash)
    for (const name of [...names, '../../CLAUDE.md'])
      expect(statSync(join(folder, name)).mtimeMs).toBe(1000)
    const preferences = join(f.botHome, '..', 'shared', 'preferences.md')
    writeFileSync(preferences, 'Keep replies short.\n')
    expect(await render()).not.toBe(hash)
    expect(readFileSync(join(folder, 'preferences.md'), 'utf8')).toContain('Keep replies short.\n')
    expect(statSync(join(folder, 'you.md')).mtimeMs).toBe(1000)
    await botInstructions(
      { ...bot, permissionMode: 'full_access' },
      projects,
      behaviours,
      f.botHome
    )
    expect(readFileSync(join(folder, 'talking.md'), 'utf8')).not.toContain(
      'Some of your own actions need'
    )
    expect(readFileSync(join(folder, 'workers.md'), 'utf8')).toContain('Workers start in Auto.')
    await commitBotHome(f.botHome)
    const git = Bun.spawn(['git', '-C', f.botHome, 'ls-files'], { stdout: 'pipe' })
    const tracked = (await new Response(git.stdout).text()).trim().split('\n')
    expect(await git.exited).toBe(0)
    expect(tracked).toContain('CLAUDE.md')
    expect(tracked).toContain('.gitignore')
    expect(tracked.some((name) => name.startsWith('.jetty/'))).toBe(false)
  })

  test('changed bot instructions recycle a warm session with resume, while steering keeps its files', async () => {
    const f = await setup({ bot: true })
    const first = await f.start('first')
    const q = f.queries[0]!
    expect(q.options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
    expect(q.options.cwd).toBe(f.botHome)
    q.push({
      type: 'system',
      subtype: 'init',
      session_id: 'bot-resume',
      tools: ['AskUserQuestion'],
    })
    const preferences = join(f.botHome, '..', 'shared', 'preferences.md')
    const rendered = join(f.botHome, '.jetty', 'instructions', 'preferences.md')
    writeFileSync(preferences, 'New preferences.\n')
    expect(await f.runtime.runPromise(f.agent.steer(f.thread.id, 'steering'))).toBe(true)
    expect(readFileSync(rendered, 'utf8')).toContain('(none yet)')
    expect(q.closed).toBe(false)
    q.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(first.await)
    const second = await f.start('second')
    expect(q.closed).toBe(true)
    expect(f.queries).toHaveLength(2)
    expect(f.queries[1]!.options.resume).toBe('bot-resume')
    expect(f.queries[1]!.options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
    expect(readFileSync(rendered, 'utf8')).toContain('New preferences.\n')
    f.queries[1]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(second.await)
    writeFileSync(join(f.botHome, 'brief.md'), 'Updated job')
    writeFileSync(join(f.botHome, 'index.md'), 'Updated wiki')
    const third = await f.start('third')
    expect(f.queries).toHaveLength(2)
    f.queries[1]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(third.await)
    await f.runtime.runPromise(f.store.setAgentBehaviour('watchPullRequests', true))
    const fourth = await f.start('fourth')
    expect(f.queries).toHaveLength(3)
    expect(f.queries[1]!.closed).toBe(true)
    expect(f.queries[2]!.options.resume).toBe('bot-resume')
    f.queries[2]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(fourth.await)
  })

  test('threads keep their Jetty system prompt append', async () => {
    const f = await setup({
      mcp: async () => ({ type: 'sdk', name: 'jetty', instance: {} as never }),
    })
    const turn = await f.start()
    const behaviours = await f.runtime.runPromise(f.store.getAgentBehaviours())
    expect(f.queries[0]!.options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: jettyInstructions(behaviours),
    })
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(turn.await)
  })

  for (const kind of ['approval', 'question'] as const) {
    for (const stage of ['item completion', 'running status'] as const) {
      test(`${kind} response survives failure during ${stage} without losing or contradicting its decision`, async () => {
        let fail = false
        const f = await setup({}, {}, (event) =>
          Effect.suspend(() =>
            fail &&
            (stage === 'item completion'
              ? event.type === 'item.completed'
              : event.type === 'session.status' && event.status === 'running')
              ? Effect.fail(new AgentError('write failed'))
              : Effect.void
          )
        )
        await f.start()
        const decision = await pendingDecision(f, kind)
        fail = true
        await expect(decision.respond('allow')).rejects.toThrow('write failed')
        if (stage === 'item completion') {
          expect(decision.settled).toBe(false)
          fail = false
          expect(await decision.respond('allow')).toBe(true)
        } else {
          expect(await decision.respond('deny')).toBe(false)
        }
        expect((await decision.callback)?.behavior).toBe('allow')
        expect(f.queries[0]!.closed).toBe(false)
        expect(
          f.events.filter(
            (event) => event.type === 'item.completed' && event.itemId === decision.itemId
          )
        ).toEqual([
          {
            type: 'item.completed',
            itemId: decision.itemId,
            patch: kind === 'approval' ? { decision: 'allow' } : { answers: { 'Which?': 'A' } },
          },
        ])
      })
    }

    for (const stage of ['item completion', 'running status'] as const) {
      test(`${kind} serializes conflicting responses while ${stage} publication is suspended`, async () => {
        const entered = Deferred.makeUnsafe<void>()
        const release = Deferred.makeUnsafe<void>()
        const f = await setup({}, {}, (event) =>
          (
            stage === 'item completion'
              ? event.type === 'item.completed'
              : event.type === 'session.status' && event.status === 'running'
          )
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void
        )
        await f.start()
        const decision = await pendingDecision(f, kind)
        const first = decision.respond('allow')
        await f.runtime.runPromise(Deferred.await(entered))
        const second = decision.respond('deny')
        expect(decision.settled).toBe(false)
        expect(f.events.filter((event) => event.type === 'item.completed')).toHaveLength(
          stage === 'item completion' ? 0 : 1
        )
        await f.runtime.runPromise(Deferred.succeed(release, undefined))
        expect(await first).toBe(true)
        expect(await second).toBe(false)
        expect((await decision.callback)?.behavior).toBe('allow')
        expect(f.events.filter((event) => event.type === 'item.completed')).toHaveLength(1)
      })
    }

    test(`${kind} rejects a response racing a failed awaiting-status publication`, async () => {
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      let itemId = ''
      const f = await setup({}, {}, (event) =>
        Effect.gen(function* () {
          if (event.type === 'item.started' && event.item.kind === kind) itemId = event.item.id
          if (event.type === 'session.status' && event.status === 'awaiting_approval') {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return yield* Effect.fail(new AgentError('write failed'))
          }
        })
      )
      const turn = await f.start()
      const callback = askDecision(f, kind)
      await f.runtime.runPromise(Deferred.await(entered))
      const response = f.runtime.runPromise(
        kind === 'approval'
          ? f.agent.respondToApproval(f.thread.id, itemId, 'allow')
          : f.agent.respondToQuestion(f.thread.id, itemId, { 'Which?': 'A' })
      )
      await f.runtime.runPromise(Deferred.succeed(release, undefined))
      expect(await response).toBe(false)
      expect((await callback)?.behavior).toBe('deny')
      await f.runtime.runPromise(turn.await)
      expect(f.queries[0]!.closeCount).toBe(1)
      expect(f.events.filter((event) => event.type === 'item.completed')).toEqual([
        {
          type: 'item.completed',
          itemId,
          patch: kind === 'approval' ? { withdrawn: true } : { skipped: true },
        },
      ])
    })

    for (const winner of ['response', 'interrupt'] as const) {
      test(`${kind} publishes one decision when ${winner} wins an interrupt-versus-response race`, async () => {
        const entered = Deferred.makeUnsafe<void>()
        const release = Deferred.makeUnsafe<void>()
        const f = await setup({}, {}, (event) =>
          event.type === 'item.completed'
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void
        )
        await f.start()
        const decision = await pendingDecision(f, kind)
        const first =
          winner === 'response'
            ? decision.respond('allow')
            : f.runtime.runPromise(f.agent.interrupt(f.thread.id))
        await f.runtime.runPromise(Deferred.await(entered))
        const second =
          winner === 'response'
            ? f.runtime.runPromise(f.agent.interrupt(f.thread.id))
            : decision.respond('allow')
        expect(decision.settled).toBe(false)
        await f.runtime.runPromise(Deferred.succeed(release, undefined))
        const values = await Promise.all([first, second])
        expect(values[winner === 'response' ? 0 : 1]).toBe(winner === 'response')
        expect((await decision.callback)?.behavior).toBe(winner === 'response' ? 'allow' : 'deny')
        expect(f.events.filter((event) => event.type === 'item.completed')).toEqual([
          {
            type: 'item.completed',
            itemId: decision.itemId,
            patch:
              kind === 'approval'
                ? winner === 'response'
                  ? { decision: 'allow' }
                  : { withdrawn: true }
                : winner === 'response'
                  ? { answers: { 'Which?': 'A' } }
                  : { skipped: true },
          },
        ])
      })
    }

    test(`${kind} closes the real query before denying when interruption cannot persist its decision`, async () => {
      const f = await setup({}, {}, (event) =>
        event.type === 'item.completed' ? Effect.fail(new AgentError('write failed')) : Effect.void
      )
      const turn = await f.start()
      const decision = await pendingDecision(f, kind)
      const callback = decision.callback.then((result) => {
        expect(f.queries[0]!.closed).toBe(true)
        return result
      })
      await expect(f.runtime.runPromise(f.agent.interrupt(f.thread.id))).rejects.toThrow(
        'write failed'
      )
      expect((await callback)?.behavior).toBe('deny')
      await f.runtime.runPromise(turn.await)
      expect(f.queries[0]!.closeCount).toBe(1)
      expect(await decision.respond('allow')).toBe(false)
    })

    for (const stage of ['item start', 'awaiting status'] as const) {
      test(`${kind} setup failure during ${stage} retires the session and settles its callback`, async () => {
        let itemId = ''
        const f = await setup({}, {}, (event) =>
          Effect.suspend(() => {
            if (event.type === 'item.started' && event.item.kind === kind) {
              itemId = event.item.id
              if (stage === 'item start') return Effect.fail(new AgentError('write failed'))
            }
            return stage === 'awaiting status' &&
              event.type === 'session.status' &&
              event.status === 'awaiting_approval'
              ? Effect.fail(new AgentError('write failed'))
              : Effect.void
          })
        )
        const turn = await f.start()
        expect((await askDecision(f, kind))?.behavior).toBe('deny')
        await f.runtime.runPromise(turn.await)
        expect(f.queries[0]!.closeCount).toBe(1)
        expect(
          await f.runtime.runPromise(
            kind === 'approval'
              ? f.agent.respondToApproval(f.thread.id, itemId, 'allow')
              : f.agent.respondToQuestion(f.thread.id, itemId, {})
          )
        ).toBe(false)
        const retry = await f.start('retry')
        f.queries[1]!.push({ type: 'result', subtype: 'success' })
        await f.runtime.runPromise(retry.await)
        expect(f.queries[0]!.closeCount).toBe(1)
      })
    }
  }

  test('a grace timer waiting on terminal publication cannot deadlock or close the reused session', async () => {
    const f = await setup()
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const first = await f.runtime.runPromise(
      f.agent.startTurn({ threadId: f.thread.id, turnId: 'first', text: 'hello' }, (event) =>
        Effect.gen(function* () {
          if (event.type === 'turn.failed') {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }
          yield* f.emit(event)
        })
      )
    )
    await f.runtime.runPromise(f.agent.interrupt(f.thread.id))
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(Deferred.await(entered))
    await f.runtime.runPromise(TestClock.adjust(100))
    await f.runtime.runPromise(Deferred.succeed(release, undefined))
    await f.runtime.runPromise(first.await)
    const next = await f.start('next')
    expect(f.queries).toHaveLength(1)
    expect(f.queries[0]!.closeCount).toBe(0)
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(next.await)
    expect(f.events.filter((event) => event.type === 'turn.failed')).toMatchObject([
      { turnId: 'first', error: 'interrupted' },
    ])
    expect(f.events.filter((event) => event.type === 'turn.completed')).toMatchObject([
      { turnId: 'next' },
    ])
  })

  test('Claude rejects steering as soon as a result is observed, while its terminal write is suspended', async () => {
    const f = await setup()
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const first = await f.runtime.runPromise(
      f.agent.startTurn({ threadId: f.thread.id, turnId: 'first', text: 'hello' }, (event) =>
        Effect.gen(function* () {
          if (event.type === 'turn.completed') {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }
          yield* f.emit(event)
        })
      )
    )
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(Deferred.await(entered))
    expect(await f.runtime.runPromise(f.agent.steer(f.thread.id, 'late input'))).toBe(false)
    let started = false
    const next = f.start('next').then((turn) => {
      started = true
      return turn
    })
    await f.runtime.runPromise(Effect.yieldNow)
    expect(started).toBe(false)
    await f.runtime.runPromise(Deferred.succeed(release, undefined))
    await f.runtime.runPromise(first.await)
    const nextTurn = await next
    expect(f.queries).toHaveLength(1)
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(nextTurn.await)
    expect(f.events.filter((event) => event.type === 'turn.completed')).toHaveLength(2)
  })

  test.each(['send_images', 'send_video'] as const)(
    '%s rejects stale HTTP publication after a terminal event and removes unreferenced media',
    async (name) => {
      const f = await setup()
      const first = await f.runtime.runPromise(
        f.orch.startTurnEffect({ threadId: f.thread.id, text: 'media' })
      )
      const copied = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const persistFile = f.attachments.persistFile
      f.attachments.persistFile = (path, kind) =>
        persistFile(path, kind).pipe(
          Effect.tap(() => Deferred.succeed(copied, undefined)),
          Effect.tap(() => Deferred.await(release))
        )
      const file = name === 'send_images' ? 'image.png' : 'video.mp4'
      writeFileSync(join(f.home, file), 'media')
      const pending = f.callMedia(name, file)
      await f.runtime.runPromise(Deferred.await(copied))
      expect(readdirSync(f.attachments.dir)).toHaveLength(1)
      f.queries[0]!.push({ type: 'result', subtype: 'success' })
      while (f.orch.currentTurn(f.thread.id) === first.turnId) await new Promise(setImmediate)
      await f.runtime.runPromise(Deferred.succeed(release, undefined))
      expect((await pending).isError).toBe(true)
      expect(readdirSync(f.attachments.dir)).toEqual([])
      const state = await f.runtime.runPromise(f.store.getThreadState(f.thread.id))
      expect(state.items.some((i) => i.kind === 'image_gallery' || i.kind === 'video')).toBe(false)
    }
  )

  test.each(['send_images', 'send_video'] as const)(
    '%s transfers committed attachment ownership through HTTP',
    async (name) => {
      const f = await setup()
      await f.runtime.runPromise(f.orch.startTurnEffect({ threadId: f.thread.id, text: 'media' }))
      const file = name === 'send_images' ? 'image.png' : 'video.mp4'
      writeFileSync(join(f.home, file), 'media')
      expect((await f.callMedia(name, file)).isError).toBeFalsy()
      f.queries[0]!.push({ type: 'result', subtype: 'success' })
      while (f.orch.currentTurn(f.thread.id)) await new Promise(setImmediate)
      const state = await f.runtime.runPromise(f.store.getThreadState(f.thread.id))
      const item = state.items.find(
        (item) => item.kind === 'image_gallery' || item.kind === 'video'
      )
      if (!item || (item.kind !== 'image_gallery' && item.kind !== 'video'))
        throw new Error('Missing durable media item')
      const attachment = item.kind === 'video' ? item.video : item.images[0]!
      expect(await f.runtime.runPromise(f.attachments.resolve(attachment.id))).not.toBeNull()
      expect(readdirSync(f.attachments.dir)).toHaveLength(1)
      expect(state.status).toBe('idle')
    }
  )

  test.each([false, true])(
    'a failed Claude start closes its %s warm session once and permits retry despite failing cleanup writes',
    async (warm) => {
      const f = await setup()
      if (warm) {
        const previous = await f.start('previous')
        f.queries[0]!.push({ type: 'result', subtype: 'success' })
        await f.runtime.runPromise(previous.await)
      }
      await expect(
        f.runtime.runPromise(
          f.agent.startTurn({ threadId: f.thread.id, turnId: 'failed', text: 'hello' }, () =>
            Effect.fail(new AgentError('write failed'))
          )
        )
      ).rejects.toThrow('write failed')
      expect(f.queries[0]!.closeCount).toBe(1)
      const retry = await f.start('retry')
      expect(f.queries).toHaveLength(2)
      f.queries[1]!.push({ type: 'result', subtype: 'success' })
      await f.runtime.runPromise(retry.await)
      await f.runtime.dispose()
      expect(f.queries[0]!.closeCount).toBe(1)
      expect(f.queries[1]!.closeCount).toBe(1)
    }
  )

  test('account usage single-flight is adapter-local and suppresses a stale response after shutdown', async () => {
    const response = {
      session: {
        total_cost_usd: 0,
        total_api_duration_ms: 0,
        total_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
        model_usage: {},
      },
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 42, resets_at: '2026-09-08T12:00:00.000Z' },
        seven_day: { utilization: 18, resets_at: '2026-09-10T00:00:00.000Z' },
      },
      behaviors: null,
    } satisfies SDKControlGetUsageResponse
    let release!: (response: SDKControlGetUsageResponse) => void
    const pending = new Promise<SDKControlGetUsageResponse>((resolve) => {
      release = resolve
    })
    let reads = 0
    const slow = fakeQueries(() => {
      reads++
      return pending
    })
    const fast = fakeQueries(async () => response)
    const stale: unknown[] = []
    const first = await setup(
      { query: slow.factory },
      {
        onUsage: (usage) => {
          stale.push(usage)
        },
      }
    )
    const firstTurn = await first.start()
    slow.queries[0]!.push({ type: 'result', subtype: 'success' })
    await first.runtime.runPromise(firstTurn.await)
    const seen = Deferred.makeUnsafe<void>()
    const second = await setup(
      { query: fast.factory },
      {
        onUsage: () => {
          Deferred.doneUnsafe(seen, Effect.void)
        },
      }
    )
    await second.start()
    await second.runtime.runPromise(Deferred.await(seen))
    expect(reads).toBe(1)
    await first.runtime.dispose()
    release(response)
    await pending
    await Promise.resolve()
    expect(stale).toEqual([])
  })

  test('steering waits for durable acceptance and never enqueues failed input', async () => {
    const f = await setup()
    await f.start('first')
    const input = f.queries[0]!.input
    expect((await input.next()).value.message.content).toBe('hello')
    await expect(
      f.runtime.runPromise(
        f.agent.steer(
          f.thread.id,
          'lost',
          undefined,
          Effect.fail(new AgentError('persistence failed'))
        )
      )
    ).rejects.toThrow('persistence failed')
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    let consumed = false
    const next = input.next().then((message) => {
      consumed = true
      return message
    })
    const accepted = f.runtime.runPromise(
      f.agent.steer(
        f.thread.id,
        'durable',
        undefined,
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          yield* f.store
            .appendEvent(f.thread.id, {
              type: 'item.started',
              item: {
                id: 'accepted',
                kind: 'user_message',
                text: 'durable',
                attachments: [],
                turnId: 'first',
                createdAt: 1,
              },
            })
            .pipe(Effect.mapError((error) => new AgentError(error.message)))
        })
      )
    )
    await f.runtime.runPromise(Deferred.await(entered))
    expect(consumed).toBe(false)
    await f.runtime.runPromise(Deferred.succeed(release, undefined))
    expect(await accepted).toBe(true)
    expect((await next).value.message.content).toBe('durable')
    expect((await f.runtime.runPromise(f.store.getThreadState(f.thread.id))).items).toMatchObject([
      { id: 'accepted', text: 'durable' },
    ])
  })

  test('the SDK input queue preserves steering images and settles pending reads on close', async () => {
    const f = await setup()
    await f.start('first')
    const input = f.queries[0]!.input
    expect((await input.next()).value.message.content).toBe('hello')
    expect(
      await f.runtime.runPromise(
        f.agent.steer(f.thread.id, 'steering', [{ mimeType: 'image/png', base64data: 'aGVsbG8=' }])
      )
    ).toBe(true)
    expect((await input.next()).value.message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
      { type: 'text', text: 'steering' },
    ])
    const waiting = input.next()
    await f.runtime.dispose()
    expect((await waiting).done).toBe(true)
  })

  test('approval and question responses complete their ledger items before releasing SDK callbacks', async () => {
    const f = await setup()
    const turn = await f.start('first')
    const q = f.queries[0]!
    const approval = q.options.canUseTool!(
      'Bash',
      { command: 'true' },
      { signal: new AbortController().signal, toolUseID: 'approval', requestId: 'approval' }
    )
    await f.runtime.runPromise(f.next('session.status'))
    const item = f.events.find(
      (event) => event.type === 'item.started' && event.item.kind === 'approval'
    )
    if (!item || item.type !== 'item.started') throw new Error('Missing approval')
    expect(
      await f.runtime.runPromise(
        f.agent.respondToApproval(f.thread.id, item.item.id, 'deny', '  Not now  ')
      )
    ).toBe(true)
    expect(await approval).toEqual({
      behavior: 'deny',
      message: "User's note on the denied approval: Not now",
    })
    expect(f.events).toContainEqual({
      type: 'item.completed',
      itemId: item.item.id,
      patch: { decision: 'deny', deniedReason: 'Not now' },
    })
    expect(
      await f.runtime.runPromise(f.agent.respondToApproval(f.thread.id, item.item.id, 'allow'))
    ).toBe(false)
    await f.runtime.runPromise(f.next('session.status'))
    const question = q.options.canUseTool!(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Which?',
            header: 'Choice',
            options: [
              { label: 'A', description: 'First' },
              { label: 'B', description: 'Second' },
            ],
            multiSelect: false,
          },
        ],
      },
      { signal: new AbortController().signal, toolUseID: 'question', requestId: 'question' }
    )
    await f.runtime.runPromise(f.next('session.status'))
    const questionItem = f.events.find(
      (event) => event.type === 'item.started' && event.item.kind === 'question'
    )
    if (!questionItem || questionItem.type !== 'item.started') throw new Error('Missing question')
    const answers = { 'Which?': 'A' }
    expect(
      await f.runtime.runPromise(
        f.agent.respondToQuestion(f.thread.id, questionItem.item.id, answers)
      )
    ).toBe(true)
    expect(await question).toMatchObject({ behavior: 'allow', updatedInput: { answers } })
    expect(f.events).toContainEqual({
      type: 'item.completed',
      itemId: questionItem.item.id,
      patch: { answers },
    })
    q.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(turn.await)
  })

  test('read-only Claude sessions remove editing tools on start and resume', async () => {
    const f = await setup()
    const first = await f.start('read', { readOnly: true })
    expect(f.queries[0]!.options.disallowedTools).toEqual([
      'EnterPlanMode',
      'ExitPlanMode',
      'Edit',
      'Write',
      'NotebookEdit',
    ])
    f.queries[0]!.push({ type: 'system', subtype: 'init', session_id: 'read-only-session' })
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(first.await)
    f.queries[0]!.rejectControls()
    const resumed = await f.start('resume-read', { readOnly: true, model: 'sonnet' })
    expect(f.queries[1]!.options.resume).toBe('read-only-session')
    expect(f.queries[1]!.options.disallowedTools).toEqual([
      'EnterPlanMode',
      'ExitPlanMode',
      'Edit',
      'Write',
      'NotebookEdit',
    ])
    f.queries[1]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(resumed.await)
  })

  test('settled sessions stay warm and apply model, effort and mode changes live, recycling with resume only if that fails', async () => {
    const f = await setup()
    const first = await f.start('first')
    expect(f.queries[0]!.options.disallowedTools).toEqual(['EnterPlanMode', 'ExitPlanMode'])
    f.queries[0]!.push({ type: 'system', subtype: 'init', session_id: 'resume-me' })
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(first.await)
    const second = await f.start('second')
    expect(f.queries).toHaveLength(1)
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(second.await)
    expect(f.queries[0]!.options.allowDangerouslySkipPermissions).toBe(true)
    for (const [index, extra] of [
      { model: 'sonnet' },
      { model: 'sonnet', effort: 'high' as const },
      { model: 'sonnet', effort: 'high' as const, permissionMode: 'full_access' as const },
    ].entries()) {
      const turn = await f.start(`live-${index}`, extra)
      expect(f.queries).toHaveLength(1)
      f.queries[0]!.push({ type: 'result', subtype: 'success' })
      await f.runtime.runPromise(turn.await)
    }
    expect(f.queries[0]!.controls).toEqual([
      ['setModel', 'sonnet'],
      ['applyFlagSettings', { effortLevel: 'high' }],
      ['setPermissionMode', 'bypassPermissions'],
    ])
    f.queries[0]!.rejectControls()
    const recycled = await f.start('recycle', { model: 'opus' })
    expect(f.queries).toHaveLength(2)
    expect(f.queries[0]!.closed).toBe(true)
    expect(f.queries[1]!.options.resume).toBe('resume-me')
    expect(f.queries[1]!.options.model).toBe('opus')
    f.queries[1]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(recycled.await)
  })

  test('shutdown settles pending approvals and questions and closes the real query before joining its reader', async () => {
    const f = await setup()
    await f.start()
    const q = f.queries[0]!
    const approval = q.options.canUseTool!(
      'Bash',
      { command: 'true' },
      { signal: new AbortController().signal, toolUseID: 'approval', requestId: 'approval' }
    )
    await f.runtime.runPromise(f.next('session.status'))
    const question = q.options.canUseTool!(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Which?',
            header: 'Choice',
            options: [
              { label: 'A', description: 'First' },
              { label: 'B', description: 'Second' },
            ],
            multiSelect: false,
          },
        ],
      },
      { signal: new AbortController().signal, toolUseID: 'question', requestId: 'question' }
    )
    await f.runtime.runPromise(f.next('session.status'))
    await f.runtime.dispose()
    expect((await approval)?.behavior).toBe('deny')
    expect((await question)?.behavior).toBe('deny')
    expect(q.closed).toBe(true)
    expect(f.events.filter((event) => event.type === 'turn.failed')).toHaveLength(1)
    expect(f.events.filter((event) => event.type === 'item.completed')).toHaveLength(2)
  })

  test('an aborted permission callback settles only its own prompt and the turn carries on', async () => {
    const f = await setup()
    const turn = await f.start()
    const q = f.queries[0]!
    const abort = new AbortController()
    const approval = q.options.canUseTool!(
      'Bash',
      { command: 'true' },
      { signal: abort.signal, toolUseID: 'approval', requestId: 'approval' }
    )
    await f.runtime.runPromise(f.next('session.status'))
    const item = f.events.find((e) => e.type === 'item.started' && e.item.kind === 'approval')
    if (item?.type !== 'item.started') throw new Error('Missing approval')
    abort.abort()
    expect((await approval)?.behavior).toBe('deny')
    expect(await f.runtime.runPromise(f.next('session.status'))).toMatchObject({
      status: 'running',
    })
    expect(f.events.filter((e) => e.type === 'item.completed')).toEqual([
      { type: 'item.completed', itemId: item.item.id, patch: { withdrawn: true } },
    ])
    expect(q.closed).toBe(false)
    q.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(turn.await)
    expect(f.events.filter((e) => e.type === 'turn.failed')).toHaveLength(0)
    expect(f.events.filter((e) => e.type === 'turn.completed')).toHaveLength(1)
  })

  test('stream failures close the query and emit only one terminal', async () => {
    const f = await setup()
    const turn = await f.start()
    f.queries[0]!.fail(new Error('stream broke'))
    await f.runtime.runPromise(turn.await)
    expect(f.queries[0]!.closed).toBe(true)
    expect(f.events.filter((event) => event.type === 'turn.failed')).toMatchObject([
      { error: 'Error: stream broke' },
    ])
  })

  test('idle expiry cannot close a reused active session', async () => {
    const f = await setup()
    const first = await f.start()
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(first.await)
    await f.runtime.runPromise(TestClock.adjust(900))
    const second = await f.start()
    await f.runtime.runPromise(TestClock.adjust(200))
    expect(f.queries[0]!.closed).toBe(false)
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(second.await)
    await f.runtime.runPromise(TestClock.adjust(1000))
    expect(f.queries[0]!.closed).toBe(true)
  })

  test('interrupt grace closes a stuck query, and old callbacks cannot touch its replacement', async () => {
    const f = await setup()
    const first = await f.start('first')
    const old = f.queries[0]!
    await f.runtime.runPromise(f.agent.interrupt(f.thread.id))
    await f.runtime.runPromise(TestClock.adjust(100))
    await f.runtime.runPromise(first.await)
    expect(old.interrupts).toBe(1)
    expect(old.closed).toBe(true)
    const next = await f.start('next')
    const count = f.events.length
    expect(
      (
        await old.options.canUseTool!(
          'Bash',
          {},
          { signal: new AbortController().signal, toolUseID: 'stale', requestId: 'stale' }
        )
      )?.behavior
    ).toBe('deny')
    old.push({ type: 'result', subtype: 'success' })
    expect(f.events).toHaveLength(count)
    f.queries[1]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(next.await)
    expect(f.events.filter((event) => event.type === 'turn.failed')).toMatchObject([
      { turnId: 'first', error: 'interrupted' },
    ])
  })

  test('a result during interrupt grace settles once and its timer cannot kill the next turn', async () => {
    const f = await setup()
    const first = await f.start('first')
    await f.runtime.runPromise(f.agent.interrupt(f.thread.id))
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(first.await)
    const next = await f.start('next')
    await f.runtime.runPromise(TestClock.adjust(200))
    expect(f.queries[0]!.closed).toBe(false)
    f.queries[0]!.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(next.await)
    expect(f.events.filter((event) => event.type === 'turn.failed')).toHaveLength(1)
    expect(f.events.filter((event) => event.type === 'turn.completed')).toHaveLength(1)
  })
})

test('background watches survive idle TTL, wake a synthetic turn, and stop individually or together', async () => {
  let tasks: readonly import('@jetty/shared/wire').BackgroundTask[] = []
  const f = await setup(
    {},
    {
      onBackgroundTasks: (_id, next) =>
        Effect.sync(() => {
          tasks = next
        }),
    }
  )
  const turn = await f.start('monitor-parent')
  const q = f.queries[0]!
  q.push({
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'shell-tool',
          name: 'Bash',
          input: { command: 'sleep 20 && echo done', run_in_background: true },
        },
      ],
    },
  })
  q.push({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [
      { task_id: 'shell', task_type: 'local_bash', description: 'Wait for done' },
      { task_id: 'watch', task_type: 'monitor_mcp', description: 'Watch checks' },
      { task_id: 'ambient', task_type: 'monitor_ws', description: 'Housekeeping', ambient: true },
    ],
  })
  q.push({ type: 'system', subtype: 'task_started', task_id: 'shell', tool_use_id: 'shell-tool' })
  q.push({ type: 'result', subtype: 'success' })
  await f.runtime.runPromise(turn.await)
  expect(tasks.map((task) => task.label)).toEqual(['sleep 20 && echo done', 'Watch checks'])
  expect(f.agent.busy?.(f.thread.id)).toBe(false)
  await f.runtime.runPromise(TestClock.adjust(2000))
  expect(q.closed).toBe(false)
  q.push({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: 'done' }] },
  })
  const wake = await f.runtime.runPromise(f.next('turn.started'))
  expect(wake).toMatchObject({ type: 'turn.started' })
  q.push({ type: 'result', subtype: 'success' })
  await f.runtime.runPromise(f.next('turn.completed'))
  expect(
    f.events.some(
      (event) =>
        event.type === 'item.started' &&
        event.item.kind === 'assistant_message' &&
        event.item.text === 'done'
    )
  ).toBe(true)
  await f.runtime.runPromise(f.agent.stopBackgroundTasks!(f.thread.id, 'shell'))
  expect(tasks.map((task) => task.id)).toEqual(['watch'])
  q.rejectControls()
  await expect(f.runtime.runPromise(f.agent.stopBackgroundTasks!(f.thread.id))).rejects.toThrow(
    'control failed'
  )
  expect(tasks.map((task) => task.id)).toEqual(['watch'])
  // The level signal settles the watch independently of the failed stop control.
  q.push({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })
  await f.runtime.runPromise(TestClock.adjust(2000))
  expect(tasks).toEqual([])
  expect(q.closed).toBe(true)
  expect(q.controls).toContainEqual(['stopTask', 'shell'])
})

test('Stop all removes every watch immediately and arms the normal idle timer', async () => {
  let tasks: readonly import('@jetty/shared/wire').BackgroundTask[] = []
  const f = await setup(
    {},
    {
      onBackgroundTasks: (_id, next) =>
        Effect.sync(() => {
          tasks = next
        }),
    }
  )
  const turn = await f.start()
  const q = f.queries[0]!
  q.push({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [
      { task_id: 'shell', task_type: 'local_bash', description: 'shell' },
      { task_id: 'monitor', task_type: 'monitor_mcp', description: 'monitor' },
    ],
  })
  q.push({ type: 'result', subtype: 'success' })
  await f.runtime.runPromise(turn.await)
  await f.runtime.runPromise(f.agent.stopBackgroundTasks!(f.thread.id))
  expect(tasks).toEqual([])
  expect(q.controls).toEqual([
    ['stopTask', 'shell'],
    ['stopTask', 'monitor'],
  ])
  await f.runtime.runPromise(TestClock.adjust(999))
  expect(q.closed).toBe(false)
  await f.runtime.runPromise(TestClock.adjust(1))
  expect(q.closed).toBe(true)
})

for (const abandoned of [false, true]) {
  test(`a completed background subagent holds settlement until its wake ${abandoned ? 'expires' : 'starts'}`, async () => {
    const f = await setup()
    const turn = await f.start()
    const q = f.queries[0]!
    q.push({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'background-agent',
            name: 'Agent',
            input: { description: 'Explore', prompt: 'Explore', run_in_background: true },
          },
        ],
      },
    })
    q.push({ type: 'result', subtype: 'success' })
    await f.runtime.runPromise(turn.await)
    expect(f.agent.busy?.(f.thread.id)).toBe(true)
    q.push({
      type: 'system',
      subtype: 'task_notification',
      tool_use_id: 'background-agent',
      status: 'completed',
    })
    await f.runtime.runPromise(f.next('item.completed'))
    expect(f.agent.busy?.(f.thread.id)).toBe(true)
    if (abandoned) {
      await f.runtime.runPromise(TestClock.adjust(2000))
      expect(q.closed).toBe(true)
    } else {
      q.push({
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: 'Final answer' }] },
      })
      await f.runtime.runPromise(f.next('turn.started'))
      q.push({ type: 'result', subtype: 'success' })
      await f.runtime.runPromise(f.next('turn.completed'))
    }
    expect(f.agent.busy?.(f.thread.id)).toBe(false)
  })
}
