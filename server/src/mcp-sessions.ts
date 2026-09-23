import type { ProviderId } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export type McpIdentity = { threadId: string; provider: ProviderId }
export type McpSessions = ReturnType<typeof createMcpSessions>

function digest(token: string) {
  return createHash('sha256').update(token).digest()
}

export function createMcpSessions() {
  const sessions = new Map<string, { hash: Buffer; identity: McpIdentity }>()
  let url = ''
  return {
    setUrl(value: string) {
      url = value
    },
    authenticate(header: string | null) {
      if (!header?.startsWith('Bearer ')) return null
      const candidate = digest(header.slice(7))
      let identity: McpIdentity | null = null
      for (const session of sessions.values()) {
        if (timingSafeEqual(candidate, session.hash)) identity = session.identity
      }
      return identity
    },
    open(identity: McpIdentity) {
      return Effect.acquireRelease(
        Effect.sync(() => {
          const token = randomBytes(32).toString('hex')
          sessions.set(token, { hash: digest(token), identity })
          return { token, url }
        }),
        (binding) =>
          Effect.sync(() => {
            sessions.delete(binding.token)
          })
      )
    },
  }
}
