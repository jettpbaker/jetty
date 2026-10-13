import type { EffortLevel } from '@jetty/shared/events'
import type { JobModel, ModelRef } from '@jetty/shared/wire'

import { Effect, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { tmpdir } from 'node:os'

import type { ModelPrompt } from './title-model'

import { openCodexConnection } from './codex-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

export function createCodexPrompt(options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const prompt: ModelPrompt = (model, effort, fast, instructions, text) =>
      codexPrompt(model, effort, fast, instructions, text, tmpdir(), false, options).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
      )
    return prompt
  })
}

export function codexTidyPrompt(cwd: string, choice: JobModel & { model: ModelRef }, text: string) {
  return codexPrompt(choice.model, choice.effort, choice.fast === true, '', text, cwd, true).pipe(
    Effect.timeout('20 minutes')
  )
}

function codexPrompt(
  model: ModelRef,
  effort: EffortLevel | undefined,
  fast: boolean,
  instructions: string,
  text: string,
  cwd: string,
  tools: boolean,
  options: StdioProcessOptions = {}
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* openCodexConnection(cwd, options)
      const { account } = yield* connection.request('account/read', {})
      if (!account) return yield* Effect.fail(new Error('Codex is not signed in'))
      const config = tools ? object((yield* connection.request('config/read', {})).config) : {}
      const mcp = Object.fromEntries(
        Object.keys(object(config.mcp_servers)).map((name) => [
          `mcp_servers.${name}.enabled`,
          false,
        ])
      )
      const started = yield* connection.request('thread/start', {
        cwd,
        model: model.id,
        serviceTier: fast ? 'fast' : 'default',
        ephemeral: true,
        approvalPolicy: 'never',
        sandbox: tools ? 'workspace-write' : 'read-only',
        ...(tools
          ? {
              config: {
                'sandbox_workspace_write.network_access': false,
                'sandbox_workspace_write.exclude_tmpdir_env_var': true,
                'sandbox_workspace_write.exclude_slash_tmp': true,
                ...mcp,
                'features.multi_agent': false,
                web_search: 'disabled',
              },
            }
          : {}),
        ...(tools ? {} : { baseInstructions: instructions }),
      })
      const threadId = string(object(started.thread).id)
      yield* connection.request('turn/start', {
        threadId,
        input: [{ type: 'text', text, text_elements: [] }],
        ...(effort ? { effort } : {}),
        ...(tools
          ? {
              sandboxPolicy: {
                type: 'workspaceWrite',
                writableRoots: [cwd],
                networkAccess: false,
                excludeTmpdirEnvVar: true,
                excludeSlashTmp: true,
              },
            }
          : {}),
      })
      let reply = ''
      while (true) {
        const message = yield* Queue.take(connection.messages)
        if (message.id !== undefined) {
          yield* connection.reject(message.id, 'This prompt cannot approve tool requests')
          continue
        }
        if (message.params.threadId !== threadId) continue
        const item = object(message.params.item)
        if (message.method === 'item/completed' && item.type === 'agentMessage')
          reply = string(item.text)
        if (message.method === 'turn/completed') {
          const turn = object(message.params.turn)
          if (turn.status !== 'completed')
            return yield* Effect.fail(
              new Error(
                string(object(turn.error).message) ||
                  `Codex turn ${string(turn.status) || 'failed'}`
              )
            )
          return reply
        }
      }
    })
  )
}
