import type { ProviderId } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { createHash, randomBytes } from 'node:crypto'

export type McpIdentity = { threadId: string; provider: ProviderId }
export type McpSessions = ReturnType<typeof createMcpSessions>

function digest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createMcpSessions() {
  const sessions = new Map<string, McpIdentity>()
  let url = ''
  let containerUrl = ''
  return {
    setUrl(value: string) {
      url = value
    },
    setContainerUrl(value: string) {
      containerUrl = value
    },
    authenticate(header: string | null) {
      if (!header?.startsWith('Bearer ')) return null
      return sessions.get(digest(header.slice(7))) ?? null
    },
    open(identity: McpIdentity, container = false) {
      return Effect.acquireRelease(
        Effect.sync(() => {
          const token = randomBytes(32).toString('hex')
          sessions.set(digest(token), identity)
          return { token, url: container ? containerUrl : url }
        }),
        (binding) =>
          Effect.sync(() => {
            sessions.delete(digest(binding.token))
          })
      )
    },
  }
}
