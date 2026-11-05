import type { ThreadState } from '@jetty/shared/reducer'
import type { Bot, ThreadMeta } from '@jetty/shared/wire'

import { awaitsInput } from '@jetty/shared/items'

const MINUTE = 60_000

export type BotLifecycle = {
  turnEndedAt?: number
  checkedInAt?: number
  compactRetryAt?: number
  tidiedAt?: number
  tidiedHead?: string
  tidyRetryAt?: number
  managedFilesRestored?: boolean
  codexInstructionsHash?: string
}

function readTiming() {
  const timing = {
    checkInMs: {
      claude: { ms: 55 * MINUTE, requiresItems: false },
      codex: { ms: 25 * MINUTE, requiresItems: false },
      copilot: { ms: 25 * MINUTE, requiresItems: false },
      opencode: { ms: 25 * MINUTE, requiresItems: false },
      grok: { ms: 55 * MINUTE, requiresItems: true },
    },
    userActiveMs: 3 * 60 * MINUTE,
    workerStaleMs: 30 * MINUTE,
    awayIdleMs: 5 * MINUTE,
    compactAt: 0.5,
    idleCompactStartMs: 50 * MINUTE,
    idleCompactEndMs: 58 * MINUTE,
    cacheLifetimeMs: 60 * MINUTE,
    botCompactTokens: 300_000,
    threadCompactTokens: 200_000,
    compactUnskippableAt: 0.85,
    tidyEveryMs: 24 * 60 * MINUTE,
    retryMs: 30 * MINUTE,
    tickMs: 5_000,
  }
  try {
    const overrides: unknown = JSON.parse(process.env.JETTY_BOT_TIMING ?? '{}')
    if (!overrides || typeof overrides !== 'object') return timing
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
      if (key === 'checkInMs') {
        for (const provider of Object.values(timing.checkInMs)) provider.ms = value
      } else if (Object.hasOwn(timing, key)) {
        timing[key as Exclude<keyof typeof timing, 'checkInMs'>] = value
      }
    }
  } catch {}
  return timing
}

export const botTiming = readTiming()

// Shortly before a 1-hour prompt cache expires, a compact reads from it instead of paying to write
// the whole context again. Any later and it runs cold.
export function inWarmWindow(thread: ThreadMeta, now: number, timing = botTiming) {
  const idle = thread.turnEndedAt === undefined ? -1 : now - thread.turnEndedAt
  return idle >= timing.idleCompactStartMs && idle < timing.idleCompactEndMs
}

export function warmCompactionCandidate(thread: ThreadMeta, now: number, timing = botTiming) {
  return (
    inWarmWindow(thread, now, timing) &&
    thread.provider === 'claude' &&
    thread.status === 'idle' &&
    !thread.archived &&
    !thread.queuePaused &&
    !thread.awaitingParent &&
    !thread.waitingForChildren &&
    !thread.pendingMessages?.length
  )
}

export function warmCompactionDue(state: ThreadState, bot: boolean, timing = botTiming) {
  const context = state.context
  const lastTurn = Object.keys(state.turnOutcomes).at(-1)
  const compaction =
    state.items.some(
      (item) => item.turnId === lastTurn && !item.agentId && item.kind === 'compaction'
    ) &&
    !state.items.some(
      (item) => item.turnId === lastTurn && !item.agentId && item.kind === 'user_message'
    )
  return (
    state.cacheLifetime === '1h' &&
    !state.activeTurnId &&
    !state.automaticCompactionTurnId &&
    state.lastTurnOutcome === 'completed' &&
    lastTurn !== undefined &&
    state.turnOutcomes[lastTurn] === 'completed' &&
    context !== null &&
    context.usedTokens >=
      Math.min(bot ? timing.botCompactTokens : timing.threadCompactTokens, context.maxTokens / 2) &&
    !compaction &&
    !state.items.some(
      (item) =>
        awaitsInput(item) ||
        ((item.kind === 'subagent' || item.kind === 'workflow') && item.status === 'running')
    )
  )
}

// A bot woken after its cache expired compacts first, so this wake and the ones after it read a
// summary instead of writing its whole context again.
export function coldWakeCompactionDue(
  thread: ThreadMeta,
  state: ThreadState,
  now: number,
  timing = botTiming
) {
  return (
    thread.provider === 'claude' &&
    thread.status === 'idle' &&
    thread.turnEndedAt !== undefined &&
    now - thread.turnEndedAt >= timing.cacheLifetimeMs &&
    warmCompactionDue(state, true, timing)
  )
}

// When the next check-in is due, leaving out the brief it also needs, which is a file read.
export function nextCheckInAt(
  bot: Bot,
  record: BotLifecycle,
  endedAt: number,
  lastMessage: number | null,
  timing = botTiming,
  now = Date.now()
) {
  const due = Math.max(endedAt, record.checkedInAt ?? 0) + timing.checkInMs[bot.provider].ms
  return bot.checkIns && lastMessage && Math.max(due, now) - lastMessage <= timing.userActiveMs
    ? due
    : null
}
