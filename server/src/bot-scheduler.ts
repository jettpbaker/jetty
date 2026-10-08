import { newId, type Bot, type ThreadMeta } from '@jetty/shared/wire'
import { Effect, Queue, Schedule } from 'effect'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Hub } from './hub'
import type { Orchestrator } from './orchestrator'
import type { AgentRegistry } from './registry'
import type { Store } from './store'

import { botUserName } from './bot-home'
import { botTiming, type BotLifecycle } from './bot-lifecycle'
import { tidyBotHome } from './bot-tidy'

function duration(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60_000))
  if (minutes >= 120) {
    const hours = Math.round(minutes / 60)
    return `${hours} hours`
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

function checkInItems(
  bot: Bot,
  record: BotLifecycle,
  threads: readonly ThreadMeta[],
  store: Store,
  hub: Hub,
  timing: typeof botTiming,
  now: number,
  user: string
) {
  return Effect.gen(function* () {
    const lines: string[] = []
    for (const worker of threads) {
      if (worker.botId !== bot.id || worker.id === bot.id || worker.archived) continue
      const link = `[${worker.title}](jetty://threads/${worker.id})`
      const state = yield* store.getThreadState(worker.id)
      const waiting = state.items
        .filter(
          (item) =>
            (item.kind === 'approval' && !item.decision && !item.withdrawn) ||
            (item.kind === 'question' && !item.answers && !item.dismissed && !item.skipped)
        )
        .sort((a, b) => a.createdAt - b.createdAt)[0]
      if (waiting && now - waiting.createdAt >= timing.workerStaleMs) {
        lines.push(
          `${link} has waited on ${user}'s ${waiting.kind === 'approval' ? 'approval' : 'answer'} for ${duration(now - waiting.createdAt)}.`
        )
        continue
      }
      if (worker.status === 'running' && now - worker.updatedAt >= timing.workerStaleMs) {
        lines.push(`${link} has had no activity for ${duration(now - worker.updatedAt)}.`)
        continue
      }
      if (
        worker.parentThreadId === bot.id &&
        (worker.status === 'idle' || worker.status === 'error') &&
        !state.activeTurnId &&
        !hub.decorateThread(worker).backgroundTasks?.length &&
        !state.items.some(
          (item) =>
            (item.kind === 'subagent' || item.kind === 'workflow') && item.status === 'running'
        )
      ) {
        const outcome = yield* store.missingWorkerReport(
          worker.id,
          record.checkedInAt ?? bot.createdAt
        )
        if (outcome)
          lines.push(
            outcome === 'stopped'
              ? `${link} was stopped, so its report never reached you.`
              : `${link} ${outcome}, but its report never reached you.`
          )
      }
    }
    return lines
  })
}

export function startBotScheduler(
  store: Store,
  orch: Orchestrator,
  hub: Hub,
  registry: AgentRegistry,
  timing: typeof botTiming,
  allowTidy: boolean
) {
  let tidying = false
  const tick = Effect.gen(function* () {
    const now = Date.now()
    const lastMessage = yield* store.getLastUserMessageAt()
    const threads = yield* store.listThreads(true)
    for (const bot of yield* store.listBots()) {
      yield* Effect.gen(function* () {
        if (!(yield* orch.botIdle(bot.id))) return
        const thread = threads.find((thread) => thread.id === bot.id)
        if (!thread) return
        const record = yield* store.getBotLifecycle(bot.id)
        const endedAt = record.turnEndedAt ?? thread.updatedAt
        const presence = hub.botPresence(bot.id)
        const away = !presence.draft && (!presence.open || now - endedAt >= timing.awayIdleMs)
        const state = yield* store.getThreadState(bot.id)
        const fraction =
          state.context && state.context.maxTokens > 0
            ? state.context.usedTokens / state.context.maxTokens
            : 0
        const compactDue =
          away &&
          registry.agent(bot.provider)?.supportsCompaction &&
          fraction >= timing.compactAt &&
          now >= (record.compactRetryAt ?? 0)
        if (compactDue) {
          yield* orch.compact(bot.id, true)
          return
        }
        const project = yield* store.getProject(bot.id)
        if (!project) return
        const home = project.path
        if (
          allowTidy &&
          !tidying &&
          away &&
          now - (record.tidiedAt ?? bot.createdAt) >= timing.tidyEveryMs &&
          now >= (record.tidyRetryAt ?? 0)
        ) {
          tidying = true
          const started = yield* orch
            .runBotUpkeep(
              bot.id,
              Effect.gen(function* () {
                const latest = yield* store.getBotLifecycle(bot.id)
                const presence = hub.botPresence(bot.id)
                if (
                  presence.draft ||
                  (presence.open &&
                    Date.now() - (latest.turnEndedAt ?? endedAt) < timing.awayIdleMs)
                )
                  return
                yield* tidyBotHome(bot, home, store, latest)
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    tidying = false
                  })
                )
              )
            )
            .pipe(
              Effect.onError(() =>
                Effect.sync(() => {
                  tidying = false
                })
              )
            )
          if (!started) tidying = false
          if (started) return
        }
        const checkIn = timing.checkInMs[bot.provider]
        if (
          !lastMessage ||
          now - lastMessage > timing.userActiveMs ||
          now - endedAt < checkIn.ms ||
          now - (record.checkedInAt ?? 0) < checkIn.ms
        )
          return
        const brief = yield* Effect.promise(() => readFile(join(home, 'brief.md'), 'utf8'))
        if (!brief.trim()) return
        const user = yield* Effect.promise(botUserName)
        const list = yield* checkInItems(bot, record, threads, store, hub, timing, now, user)
        if (checkIn.requiresItems && !list.length) return
        yield* orch.withAdmission(
          bot.id,
          Effect.gen(function* () {
            if (!(yield* orch.botIdle(bot.id))) return
            const latest = yield* store.getBotLifecycle(bot.id)
            const current = yield* store.requireThread(bot.id)
            if (
              now - (latest.turnEndedAt ?? current.updatedAt) < checkIn.ms ||
              now - (latest.checkedInAt ?? 0) < checkIn.ms
            )
              return
            yield* store.transaction(
              Effect.gen(function* () {
                yield* store.enqueue(bot.id, {
                  id: newId(),
                  createdAt: now,
                  hop: 0,
                  text: `Check-in from Jetty. ${list.length ? list.join(' ') + ' ' : ''}Look over whatever your job covers and act on anything that needs it; if nothing does, end your turn without messaging ${user}.`,
                  kind: 'check_in',
                  from: { threadId: bot.id, title: 'Jetty' },
                })
                yield* store.updateBotLifecycle(bot.id, { checkedInAt: now })
              })
            )
            yield* Queue.offer(store.queueChanges, undefined)
            yield* Effect.logInfo(`check-in for ${bot.id}: ${list.length} items`)
          })
        )
      }).pipe(Effect.catchCause((cause) => Effect.logWarning(`lifecycle for ${bot.id}: ${cause}`)))
    }
  })
  return tick.pipe(
    Effect.catchCause((cause) => Effect.logWarning(cause)),
    Effect.repeat(Schedule.spaced(timing.tickMs)),
    Effect.forkScoped,
    Effect.asVoid
  )
}
