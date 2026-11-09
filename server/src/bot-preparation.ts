import type { PermissionMode } from '@jetty/shared/wire'

import { Effect } from 'effect'

import type { Store } from './store'

import { prepareBotHome } from './bot-home'

export function prepareBot(
  store: Store,
  threadId: string,
  home: string,
  permissionMode: PermissionMode | undefined
) {
  return Effect.gen(function* () {
    const stored = yield* store.getBot(threadId)
    if (!stored) return undefined
    const bot = { ...stored, permissionMode: permissionMode ?? stored.permissionMode }
    const projects = yield* store.listProjects()
    const behaviours = yield* store.getAgentBehaviours()
    return yield* Effect.tryPromise(() =>
      prepareBotHome(bot, projects, behaviours, home, async (text) => {
        await Effect.runPromise(
          store.enqueueOnce(bot.id, {
            id: `${bot.id}-instructions-migration`,
            text,
            createdAt: Date.now(),
            hop: 0,
            from: { threadId: bot.id, title: 'Jetty' },
          })
        )
      })
    )
  })
}
