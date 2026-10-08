import type { EffortLevel } from './events'
import type { ThreadItem } from './items'
import type { Bot } from './wire'

// Bots never get max.
export const BOT_EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh']

// The sketchpad's BotState ids, plus the error face. Typing is 'thinking'.
export type BotFace = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'tidying' | 'error'

export function botFace(bot: Pick<Bot, 'activity' | 'needsYou' | 'failed' | 'unread'>): BotFace {
  if (bot.activity === 'tidying') return 'tidying'
  if (bot.needsYou) return 'waiting'
  if (bot.activity === 'typing') return 'thinking'
  if (bot.activity === 'working') return 'working'
  if (bot.failed) return 'error'
  return 'idle'
}

// What a bot's chat shows of its thread. Messages from anyone but Jett (worker reports, Jetty's
// wakes) and the bot's private notes stay in the transcript, out of sight.
export function shownInBotChat(item: ThreadItem) {
  if (item.agentId) return false
  switch (item.kind) {
    case 'user_message':
      return !item.from
    case 'assistant_message':
      return item.private !== true
    case 'thread_marker':
    case 'error':
    case 'question':
    case 'approval':
      return true
    default:
      return false
  }
}
