import type { Skill } from '@jetty/shared/wire'

import { Effect, Queue } from 'effect'

import { openCodexConnection } from './codex-rpc'
import { openCopilotConnection } from './copilot-rpc'
import { object, string, type StdioConnection } from './stdio-rpc'

export type CodexSkill = Skill & { path: string }

export function codexSkills(connection: StdioConnection, cwd: string) {
  return Effect.gen(function* () {
    const result = yield* connection.request('skills/list', { cwds: [cwd], forceReload: true })
    const skills: CodexSkill[] = []
    for (const entry of Array.isArray(result.data) ? result.data : []) {
      const data = object(entry)
      if (data.cwd !== cwd) continue
      for (const value of Array.isArray(data.skills) ? data.skills : []) {
        const skill = object(value)
        const name = string(skill.name)
        const path = string(skill.path)
        if (skill.enabled !== false && name && path)
          skills.push({ name, path, description: string(skill.description) })
      }
    }
    return skills
  })
}

export function discoverCodexSkills(cwd: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* openCodexConnection(cwd)
      return yield* codexSkills(connection, cwd)
    })
  ).pipe(Effect.timeout('20 seconds'))
}

export function discoverCopilotSkills(cwd: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const { connection } = yield* openCopilotConnection(cwd)
      const session = yield* connection.request('session/new', { cwd, mcpServers: [] })
      while (true) {
        const message = yield* Queue.take(connection.messages)
        if (message.method !== 'session/update' || message.params.sessionId !== session.sessionId)
          continue
        const update = object(message.params.update)
        if (
          update.sessionUpdate !== 'available_commands_update' ||
          !Array.isArray(update.availableCommands)
        )
          continue
        // ACP advertises skills with this input hint alongside its built-in commands.
        return update.availableCommands
          .map(object)
          .flatMap((command): Skill[] =>
            object(command.input).hint === 'instructions for the skill' && string(command.name)
              ? [{ name: string(command.name), description: string(command.description) }]
              : []
          )
      }
    })
  ).pipe(Effect.timeout('20 seconds'))
}
