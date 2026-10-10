import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ThreadEvent } from '@jetty/shared/events'

import { query } from '@anthropic-ai/claude-agent-sdk'
import { BunServices } from '@effect/platform-bun'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { createClaudeAdapter } from './claude'
import { createClaudeCapture, type CaptureRecord } from './claude-capture'
import { databaseLayer } from './db'
import { Store, storeLayer } from './store'

const model = 'claude-opus-5-5'
const workspace = join(homedir(), 'code/scratch/cloudlets')
const readable = [
  'package.json',
  'tsconfig.json',
  'vercel.ts',
  'src/index.ts',
  'src/sandbox.ts',
  'src/mcp.ts',
]
const editable = ['src/index.ts', 'src/sandbox.ts']
const threadId = 'claude-demo-thread'
const turnId = 'claude-demo-turn'

function hash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function captureClaudeDemo() {
  const root = join(homedir(), '.capy/work/JETT-25')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const home = await mkdtemp(join(root, 'real-demo-'))
  await chmod(home, 0o700)
  const baseline = new Map<string, Buffer>()
  const expected = new Map<string, Buffer>()
  for (const name of readable) {
    const path = join(workspace, name)
    if (!(await lstat(path)).isFile() || (await realpath(path)) !== path)
      throw new Error('Demo files must be regular files without symlinks')
    const bytes = await readFile(path)
    baseline.set(name, bytes)
    expected.set(name, bytes)
    await mkdir(join(home, 'baseline', name, '..'), { recursive: true, mode: 0o700 })
    await writeFile(join(home, 'baseline', name), bytes, { mode: 0o600 })
  }
  const baselineHashes = Object.fromEntries(
    [...baseline].map(([name, bytes]) => [name, hash(bytes)])
  )
  await writeFile(join(home, 'baseline.json'), JSON.stringify(baselineHashes, null, 2), {
    mode: 0o600,
  })
  const tape = await open(join(home, 'session.tape.ndjson'), 'wx', 0o600)
  const sdk = await Bun.file(
    join(import.meta.dir, '../node_modules/@anthropic-ai/claude-agent-sdk/package.json')
  ).json()
  const capture = createClaudeCapture({
    metadata: {
      threadId,
      scenario: 'real Claude; Cloudlets exploration, reversible edits and undo',
      fidelity: 'server-observed',
      sdkVersion: sdk.version,
      normalizerVersion: hash(await readFile(join(import.meta.dir, 'claude-translate.ts'))),
    },
    write: async (line) => {
      await tape.writeFile(line)
    },
  })
  const abortController = new AbortController()
  const pendingEdits = new Map<string, { name: string; bytes: Buffer }>()
  let result: SDKResultMessage | undefined
  let observedModel: string | undefined
  let observedEffort: string | null | undefined
  let blocker: string | undefined
  let timedOut = false
  let restoreAmbiguous = false
  const toolCounts: Record<string, number> = {}
  const service = Context.Service<Effect.Success<ReturnType<typeof make>>>('demo/ClaudeCapture')
  let respond: (itemId: string) => Promise<unknown> = async () => undefined

  function relativePath(value: unknown) {
    if (typeof value !== 'string') return undefined
    const path = resolve(workspace, value)
    return readable.find((name) => path === join(workspace, name))
  }

  async function permit(toolName: string, input: Record<string, unknown>, id: string) {
    let name: string | undefined
    if (toolName === 'Read') name = relativePath(input.file_path)
    if (toolName === 'Grep') name = relativePath(input.path)
    if (toolName === 'Glob') {
      const patterns = ['src/*.ts', '*.json', 'src/index.ts', 'src/sandbox.ts', 'src/mcp.ts']
      if (
        patterns.includes(String(input.pattern)) &&
        resolve(workspace, String(input.path ?? '.')) === workspace
      )
        return true
    }
    if (toolName === 'Edit' || toolName === 'Write') {
      name = relativePath(input.file_path)
      if (pendingEdits.has(id)) return pendingEdits.get(id)!.name === name
      if (
        !name ||
        !editable.includes(name) ||
        [...pendingEdits.values()].some((entry) => entry.name === name)
      )
        return false
      const current = await readFile(join(workspace, name))
      if (!current.equals(expected.get(name)!)) {
        restoreAmbiguous = true
        return false
      }
      let next: string
      if (toolName === 'Write' && typeof input.content === 'string') next = input.content
      else if (
        toolName === 'Edit' &&
        typeof input.old_string === 'string' &&
        typeof input.new_string === 'string' &&
        input.old_string.length
      ) {
        const text = current.toString('utf8')
        const pieces = text.split(input.old_string)
        if (pieces.length < 2 || (!input.replace_all && pieces.length !== 2)) return false
        next = input.replace_all
          ? pieces.join(input.new_string)
          : text.replace(input.old_string, input.new_string)
      } else return false
      const bytes = Buffer.from(next)
      if (bytes.length > 64 * 1024) return false
      pendingEdits.set(id, { name, bytes })
    }
    if (!name) return false
    const path = join(workspace, name)
    return (await lstat(path)).isFile() && (await realpath(path)) === path
  }

  function make() {
    return Effect.gen(function* () {
      const context = yield* Layer.build(storeLayer.pipe(Layer.provide(databaseLayer(home))))
      const store = Context.get(context, Store)
      const project = yield* store.createProject(workspace)
      yield* store.createThread(project.id, threadId)
      const agent = yield* createClaudeAdapter(
        store,
        {},
        {
          capture,
          query: ({ prompt, options }) => {
            capture.lifecycle(threadId, turnId, 'query.options', {
              model,
              effort: 'high',
              permissionMode: 'default',
              includePartialMessages: options?.includePartialMessages,
              forwardSubagentText: options?.forwardSubagentText,
              persistSession: false,
              maxTurns: 20,
              maxBudgetUsd: 5,
              tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
              settingSources: [],
              strictMcpConfig: true,
            })
            const q = query({
              prompt,
              options: {
                ...options,
                pathToClaudeCodeExecutable: join(homedir(), '.local/bin/claude'),
                model,
                effort: 'high',
                env: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: 'high' },
                cwd: workspace,
                additionalDirectories: [],
                tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
                allowedTools: [],
                disallowedTools: [],
                permissionMode: 'default',
                allowDangerouslySkipPermissions: false,
                settingSources: [],
                mcpServers: {},
                agents: {},
                strictMcpConfig: true,
                persistSession: false,
                maxTurns: 20,
                maxBudgetUsd: 5,
                abortController,
                systemPrompt:
                  'You are recording a safe local software demo. Follow the user scope exactly. No secret files, outside paths, network, installations, scripts or destructive commands. Available tools are local read/search/edit only. Do not substitute another model.',
                stderr: () => {},
                canUseTool: async (toolName, toolInput, permission) => {
                  const allowed = await permit(toolName, toolInput, permission.toolUseID)
                  capture.lifecycle(threadId, turnId, 'permission.requested', {
                    toolName,
                    toolUseId: permission.toolUseID,
                    allowed,
                  })
                  if (!allowed)
                    return { behavior: 'deny', message: 'Outside the bounded demo scope' }
                  return options!.canUseTool!(toolName, toolInput, permission)
                },
                hooks: {
                  PreToolUse: [
                    {
                      hooks: [
                        async (input) => {
                          if (input.hook_event_name !== 'PreToolUse') return {}
                          const allowed = await permit(
                            input.tool_name,
                            input.tool_input as Record<string, unknown>,
                            input.tool_use_id
                          )
                          return allowed
                            ? {}
                            : {
                                hookSpecificOutput: {
                                  hookEventName: 'PreToolUse',
                                  permissionDecision: 'deny',
                                  permissionDecisionReason: 'Outside the bounded demo scope',
                                },
                              }
                        },
                      ],
                    },
                  ],
                  PostToolUse: [
                    {
                      hooks: [
                        async (input) => {
                          if (input.hook_event_name !== 'PostToolUse') return {}
                          if (input.effort?.level) observedEffort = input.effort.level
                          toolCounts[input.tool_name] = (toolCounts[input.tool_name] ?? 0) + 1
                          const edit = pendingEdits.get(input.tool_use_id)
                          if (edit) {
                            const bytes = await readFile(join(workspace, edit.name))
                            if (!bytes.equals(edit.bytes)) restoreAmbiguous = true
                            else expected.set(edit.name, bytes)
                            pendingEdits.delete(input.tool_use_id)
                          }
                          capture.lifecycle(threadId, turnId, 'tool.finished', {
                            toolName: input.tool_name,
                            toolUseId: input.tool_use_id,
                            durationMs: input.duration_ms,
                            effort: input.effort?.level,
                          })
                          return {}
                        },
                      ],
                    },
                  ],
                  PostToolUseFailure: [
                    {
                      hooks: [
                        async (input) => {
                          if (input.hook_event_name === 'PostToolUseFailure')
                            pendingEdits.delete(input.tool_use_id)
                          return {}
                        },
                      ],
                    },
                  ],
                },
              },
            })
            const iterator = q[Symbol.asyncIterator]()
            return new Proxy(q, {
              get(target, key) {
                if (key === Symbol.asyncIterator)
                  return () => ({
                    async next() {
                      const next = await iterator.next()
                      if (!next.done) {
                        const message: SDKMessage = next.value
                        if (message.type === 'system' && message.subtype === 'init') {
                          observedModel = message.model
                          observedEffort = message.effort
                          if (
                            observedModel !== model ||
                            (observedEffort != null && observedEffort !== 'high')
                          ) {
                            blocker = 'requested_model_or_effort_not_selected'
                            abortController.abort()
                          }
                        }
                        if (message.type === 'result') result = message
                      }
                      return next
                    },
                    return: () => iterator.return!(),
                  })
                const value = Reflect.get(target, key)
                return typeof value === 'function' ? value.bind(target) : value
              },
            })
          },
        }
      )
      return { agent }
    })
  }

  const runtime = ManagedRuntime.make(
    Layer.effect(service, make()).pipe(Layer.provide(BunServices.layer))
  )
  const deadline = setTimeout(
    () => {
      timedOut = true
      capture.lifecycle(threadId, turnId, 'deadline.exceeded')
      abortController.abort()
    },
    5 * 60 * 1000
  )
  try {
    const { agent } = await runtime.runPromise(service)
    respond = (itemId) => runtime.runPromise(agent.respondToApproval(threadId, itemId, 'allow'))
    function emit(event: ThreadEvent) {
      return Effect.sync(() => {
        if (event.type === 'item.started' && event.item.kind === 'approval')
          queueMicrotask(() => {
            void respond(event.item.id).catch(() => {
              blocker = 'approval_failed'
            })
          })
      })
    }
    const turn = await runtime.runPromise(
      agent.startTurn(
        {
          threadId,
          turnId,
          model,
          effort: 'high',
          text: 'Explore this Cloudlets test project using Read, Glob and Grep. There is no Git repository. Read only package.json, tsconfig.json, vercel.ts and src/index.ts, src/sandbox.ts, src/mcp.ts. Never access .env, .vercel, node_modules, auth, hidden files or any outside path. Do not execute commands or tools outside these five offered tools. Make a small real reversible code improvement in EACH of src/index.ts and src/sandbox.ts, using Edit (or Write) only. Keep the exact originals in mind. Read the edited files to inspect and describe the changes, then undo ONLY your own changes through reverse Edit calls, and Read again to verify originals. Do not commit, install, deploy, create files, or alter any other file. Finish with a concise Markdown summary with heading, list and an inline-code example. This is one recorded demo, not a production change.',
        },
        emit
      )
    )
    await runtime.runPromise(turn.await)
  } catch {
    blocker ??= 'session_failed'
  } finally {
    clearTimeout(deadline)
    await runtime.dispose()
    for (const name of editable) {
      const path = join(workspace, name)
      if (!(await lstat(path)).isFile() || (await realpath(path)) !== path) {
        restoreAmbiguous = true
        continue
      }
      const current = await readFile(path)
      if (current.equals(baseline.get(name)!)) continue
      const pending = [...pendingEdits.values()].find((edit) => edit.name === name)
      if (current.equals(expected.get(name)!) || (pending && current.equals(pending.bytes))) {
        await writeFile(path, baseline.get(name)!)
        capture.lifecycle(threadId, turnId, 'host.restored_own_edit', { name })
      } else restoreAmbiguous = true
    }
    capture.lifecycle(threadId, turnId, 'capture.stopped', { timedOut, blocker: blocker ?? null })
    await capture.stop(
      timedOut
        ? 'deadline'
        : (blocker ??
            (result?.subtype === 'error_max_budget_usd'
              ? 'budget'
              : !result
                ? 'missing_result'
                : undefined))
    )
    await tape.close()
  }
  const restored = Object.fromEntries(
    await Promise.all(
      readable.map(async (name) => {
        const path = join(workspace, name)
        const regular = (await lstat(path)).isFile() && (await realpath(path)) === path
        return [name, regular && (await readFile(path)).equals(baseline.get(name)!)]
      })
    )
  )
  const records: CaptureRecord[] = []
  for (const line of (await readFile(join(home, 'session.tape.ndjson'), 'utf8'))
    .trim()
    .split('\n')) {
    try {
      records.push(JSON.parse(line) as CaptureRecord)
    } catch {
      blocker ??= 'unreadable_capture'
      break
    }
  }
  const inputs = records
    .filter((record) => record.kind === 'output')
    .map((record, index) => ({ seq: index + 1, atMs: record.atMs, event: record.data.event }))
  const complete = capture.status().complete && Boolean(result) && !timedOut && !blocker
  const viewer = {
    id: 'cloudlets-claude-demo',
    title: 'Cloudlets · captured Opus 5.5 High session',
    fidelity: 'server-observed',
    capture: complete ? 'complete' : 'incomplete',
    durationMs: records.at(-1)?.atMs ?? 0,
    inputs,
  }
  await writeFile(join(home, 'session.viewer.json'), JSON.stringify(viewer, null, 2), {
    mode: 0o600,
  })
  const manifest = {
    fidelity: 'server-observed',
    privacy: 'local-only; unreviewed; not authorized for publication',
    clock:
      'monotonic SDK admission and pre-persistence publication offsets; not provider generation/browser time',
    tape: 'session.tape.ndjson',
    header: records[0]?.data,
    mapping: records
      .filter((record) => record.kind === 'output')
      .map((record, index) => ({
        viewerSeq: index + 1,
        tapeSeq: record.seq,
        sourceSeq: record.data.sourceSeq,
      })),
    requested: { model, effort: 'high', maxTurns: 20, maxBudgetUsd: 5, deadlineMs: 300000 },
    observed: { model: observedModel, effort: observedEffort ?? 'not exposed by init', toolCounts },
    outcome: {
      complete,
      timedOut,
      blocker: blocker ?? null,
      capture: capture.status(),
      restoreAmbiguous,
      restored,
    },
    sdkResult: result
      ? {
          subtype: result.subtype,
          isError: result.is_error,
          numTurns: result.num_turns,
          durationMs: result.duration_ms,
          totalCostUsd: result.total_cost_usd,
          usage: result.usage,
        }
      : null,
  }
  await writeFile(join(home, 'session.manifest.json'), JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  })
  console.log(
    JSON.stringify({
      home,
      ...manifest.outcome,
      requestedModel: model,
      observedModel,
      observedEffort,
      toolCounts,
      sdkResult: manifest.sdkResult,
    })
  )
  return { home, manifest }
}

if (import.meta.main) {
  if (process.argv[2] !== '--run-approved-demo')
    throw new Error(
      'A real paid Claude session requires explicit approval; pass --run-approved-demo only after approval'
    )
  await captureClaudeDemo()
}
