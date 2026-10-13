import { Effect } from 'effect'

import type { Store } from './store'

import { prepareBotHome } from './bot-home'

export function prepareBot(store: Store, threadId: string, home: string) {
  return Effect.gen(function* () {
    const bot = yield* store.getBot(threadId)
    if (!bot) return undefined
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
