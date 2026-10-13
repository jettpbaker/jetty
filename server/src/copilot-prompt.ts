import type { EffortLevel } from '@jetty/shared/events'
import type { JobModel, ModelRef } from '@jetty/shared/wire'

import { Effect, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import type { ModelPrompt } from './title-model'

import { copilotInput } from './copilot'
import { setCopilotModel } from './copilot-models'
import { COPILOT_ARGS, copilotError, openCopilotConnection } from './copilot-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

export function createCopilotPrompt(options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const prompt: ModelPrompt = (model, effort, _fast, instructions, text) =>
      copilotPrompt(model, effort, `${instructions}\n\n${text}`, tmpdir(), false, options).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
      )
    return prompt
  })
}

export function copilotTidyPrompt(
  cwd: string,
  choice: JobModel & { model: ModelRef },
  text: string
) {
  return copilotPrompt(choice.model, choice.effort, text, cwd, true).pipe(
    Effect.timeout('20 minutes')
  )
}

function copilotPrompt(
  model: ModelRef,
  effort: EffortLevel | undefined,
  text: string,
  cwd: string,
  tools: boolean,
  options: StdioProcessOptions = {}
) {
  return Effect.scoped(
    Effect.gen(function* () {
      let processOptions: StdioProcessOptions = {
        ...options,
        args: [
          ...(options.args ?? COPILOT_ARGS),
          '--available-tools=',
          '--disable-builtin-mcps',
          '--no-custom-instructions',
        ],
        env: { ...options.env, COPILOT_CUSTOM_INSTRUCTIONS_DIRS: '' },
      }
      if (tools) {
        const cliHome = yield* Effect.acquireRelease(
          Effect.tryPromise(() => mkdtemp(join(tmpdir(), 'jetty-tidy-copilot-'))),
          (path) => Effect.promise(() => rm(path, { recursive: true, force: true }))
        )
        yield* Effect.tryPromise(() =>
          writeFile(
            join(cliHome, 'settings.json'),
            JSON.stringify({ disableAllHooks: true, memory: false, ide: { autoConnect: false } })
          )
        )
        processOptions = {
          ...options,
          args: [
            ...COPILOT_ARGS,
            '--available-tools=view,glob,grep,edit,create',
            '--disable-builtin-mcps',
            '--disallow-temp-dir',
            '--no-custom-instructions',
          ],
          env: { ...options.env, COPILOT_HOME: cliHome },
        }
      }
      const root = yield* Effect.tryPromise(() => realpath(cwd))
      const { connection } = yield* openCopilotConnection(cwd, processOptions)
      const session = yield* connection.request('session/new', { cwd, mcpServers: [] })
      const sessionId = string(session.sessionId)
      yield* setCopilotModel(connection, sessionId, session, model.id, effort)
      yield* Queue.takeAll(connection.messages)
      const requestId = yield* connection.startRequest('session/prompt', {
        sessionId,
        prompt: copilotInput(text),
      })
      let reply = ''
      while (true) {
        const message = yield* Queue.take(connection.messages)
        if (message.id !== undefined) {
          if (message.method === 'session/request_permission') {
            const tool = object(message.params.toolCall)
            const input = object(tool.rawInput)
            const locations = Array.isArray(tool.locations) ? tool.locations.map(object) : []
            const paths = [
              ...locations.map((location) => location.path),
              input.path,
              input.fileName,
              input.file_path,
            ].filter((path): path is string => typeof path === 'string' && path.length > 0)
            const allowedKind = ['read', 'search', 'edit', 'delete'].includes(string(tool.kind))
            let allowed =
              tools && allowedKind && paths.length > 0 && message.params.sessionId === sessionId
            for (const path of paths) {
              const target = yield* Effect.tryPromise(() => canonical(resolve(root, path)))
              const child = relative(root, target)
              if (
                isAbsolute(child) ||
                child === '..' ||
                child.startsWith('../') ||
                child === '.git' ||
                child.startsWith('.git/')
              )
                allowed = false
            }
            const permissions = Array.isArray(message.params.options)
              ? message.params.options.map(object)
              : []
            const allow = permissions.find((option) => option.kind === 'allow_once')
            yield* connection.respond(message.id, {
              outcome:
                allowed && allow
                  ? { outcome: 'selected', optionId: allow.optionId }
                  : { outcome: 'cancelled' },
            })
          } else yield* connection.reject(message.id, 'This request does not use tools')
          continue
        }
        const update = object(message.params.update)
        const content = object(update.content)
        if (
          tools &&
          (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update')
        )
          reply = ''
        if (
          message.method === 'session/update' &&
          message.params.sessionId === sessionId &&
          update.sessionUpdate === 'agent_message_chunk' &&
          content.type === 'text'
        )
          reply += string(content.text)
        if (message.method === '$response' && message.params.requestId === requestId) {
          const error = string(object(message.params.error).message)
          if (error) return yield* Effect.fail(copilotError(error))
          if (object(message.params.result).stopReason !== 'end_turn')
            return yield* Effect.fail(new Error('GitHub Copilot prompt did not complete'))
          return reply
        }
      }
    })
  )
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = resolve(path, '..')
    if (parent === path) throw error
    return join(await canonical(parent), relative(parent, path))
  }
}
