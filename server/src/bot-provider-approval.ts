import { Effect } from 'effect'

import type { Store } from './store'

import { AgentError } from './agent'
import { botApproval } from './bot-approval'
import { type BotRuleReviewer } from './bot-rule-review'

export type BotApprovalRule = { text: string; source: string }

export function reviewBotApproval(
  store: Store,
  threadId: string,
  cwd: string,
  tool: string,
  input: Record<string, unknown>,
  reviewer?: BotRuleReviewer
) {
  return Effect.gen(function* () {
    const bot = yield* store.getBot(threadId)
    if (!bot) return undefined
    const projects = (yield* store.listProjects())
      .filter((project) => !bot.projectId || bot.projectId === project.id)
      .map((project) => ({ path: project.path, name: project.title }))
    const description = botApproval(tool, input, [], [{ path: cwd, name: 'its home' }, ...projects])
    const covered =
      bot.permissionMode !== 'full_access' && reviewer
        ? yield* reviewer(bot, { tool, input, cwd, home: cwd, projects })
        : false
    const current = covered ? yield* store.getBot(threadId) : undefined
    const unchanged =
      current && JSON.stringify(current.allowRules) === JSON.stringify(bot.allowRules)
    return { ...description, covered: covered && !!unchanged }
  }).pipe(Effect.mapError((error) => new AgentError(error.message)))
}

export function saveBotApprovalRule(
  store: Store,
  threadId: string,
  itemId: string,
  rule: BotApprovalRule
) {
  return Effect.gen(function* () {
    const bot = yield* store.getBot(threadId)
    if (!bot) return
    yield* store.setBotAllowRules(threadId, [
      ...(bot.allowRules ?? []).filter((rule) => rule.id !== itemId),
      { id: itemId, ...rule, createdAt: Date.now() },
    ])
  }).pipe(Effect.mapError((error) => new AgentError(error.message)))
}
