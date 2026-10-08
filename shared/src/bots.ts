import type { EffortLevel } from './events'
import type { ThreadItem } from './items'
import type { Bot } from './wire'

// Bots never get max.
export const BOT_EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh']

// A done or dropped task stays on its bot's list this long, then drops off (it stays stored).
export const CLOSED_TASK_SHOWN_MS = 24 * 60 * 60_000

// The sketchpad's BotState ids, plus the error face. Typing is 'thinking'.
export type BotFace = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'tidying' | 'error'

export function botFace(bot: Pick<Bot, 'activity' | 'needsYou' | 'failed' | 'unread'>): BotFace {
  if (bot.activity === 'tidying') return 'tidying'
  if (bot.activity === 'typing') return 'thinking'
  if (bot.activity === 'working') return 'working'
  if (bot.needsYou) return 'waiting'
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

// What a bot is visibly doing in a turn. Once a bubble or a reaction lands it goes quiet, until it
// starts a tool (working) or writes another say (typing), which can start before the bubble before it
// lands; its thinking and private notes don't count.
export function botTurnActivity(
  items: readonly ThreadItem[],
  turnId: string
): 'typing' | 'working' | 'quiet' {
  const latest = items.findLast(
    (item) =>
      item.turnId === turnId &&
      !item.agentId &&
      (item.kind === 'tool_call' ||
        item.kind === 'subagent' ||
        item.kind === 'workflow' ||
        (item.kind === 'assistant_message' && item.private !== true))
  )
  if (latest?.kind === 'assistant_message')
    return items.some(
      (item) =>
        item.turnId === turnId &&
        item.kind === 'tool_call' &&
        item.toolName === 'mcp__jetty__say' &&
        item.status === 'running'
    )
      ? 'typing'
      : 'quiet'
  if (latest?.kind === 'tool_call' && latest.toolName === 'mcp__jetty__react') return 'quiet'
  if (latest?.kind === 'tool_call' && latest.toolName === 'mcp__jetty__say')
    return latest.status === 'running' ? 'typing' : latest.status === 'failed' ? 'working' : 'quiet'
  return 'working'
}

// One message between a bot and another bot, as the first one's chat has it: the marker of one it
// sent, or one it got.
export type ExchangeEntry = {
  id: string
  botId: string
  sent: boolean
  at: number
  // The message's id in their conversation.
  messageId?: string
}

export function exchangeEntry(
  item: ThreadItem,
  otherBots: ReadonlySet<string>
): ExchangeEntry | undefined {
  if (item.agentId) return undefined
  if (item.kind === 'thread_marker' && item.action === 'messaged' && otherBots.has(item.threadId))
    return {
      id: item.id,
      botId: item.threadId,
      sent: true,
      at: item.createdAt,
      messageId: item.messageId,
    }
  if (item.kind === 'user_message' && item.from && otherBots.has(item.from.threadId))
    return {
      id: item.id,
      botId: item.from.threadId,
      sent: false,
      at: item.createdAt,
      messageId: item.id,
    }
  return undefined
}

// create_thread's options in a bot's own session. A read-only thread is always quiet, only a quiet
// thread can wait, and setup_worktrees starts on Jetty's own prompt instead of one from the bot.
export type QuietThreadOptions = {
  quiet?: boolean
  read_only?: boolean
  wait?: boolean
  setup_worktrees?: boolean
}

// A wait holds the bot's call this long at most, and tells the provider it's alive this often.
export const WAIT_CAP_MS = 10 * 60_000
export const WAIT_PROGRESS_MS = 15_000

// What a waiting call returns when it isn't the thread's final message. {user} is filled in.
export const WAIT_NOTES = {
  running: 'still running; its report reaches you when your turn ends',
  asked: 'It asked you this and waits for your answer: reply with send_message.',
  needs_user:
    "It's waiting on {user}'s approval or answer in its own thread, which now shows in their sidebar. Its report reaches you when your turn ends.",
} as const

// create_thread's result with wait: the usual creation result, plus how far the thread got.
export type WaitedThread = { threadId: string; link: string; created: true } & (
  | { status: 'finished'; report: string }
  | { status: 'failed'; error: string; report?: string }
  | { status: 'interrupted' }
  | { status: 'asked'; question: string; detail: (typeof WAIT_NOTES)['asked'] }
  | { status: 'needs_user'; detail: string }
  | { status: 'running'; detail: (typeof WAIT_NOTES)['running'] }
)
