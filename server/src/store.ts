import { botTurnActivity, CLOSED_TASK_SHOWN_MS, shownInBotChat } from '@jetty/shared/bots'
import { EffortLevel, ThreadEvent, type SessionStatus } from '@jetty/shared/events'
import { Attachment, heldByRestarts } from '@jetty/shared/items'
import {
  displayedRollupState,
  failedCheckConclusions,
  rollupChecks,
} from '@jetty/shared/pull-request'
import { applyEvent, emptyThread, ThreadState } from '@jetty/shared/reducer'
import {
  agentBehaviours,
  type AgentBehaviourKey,
  type AgentBehaviours,
  newId,
  type ErrorCode,
  ModelRef,
  type TitleModel,
  type Project,
  ProjectIcon,
  type ProviderId,
  type ThreadMeta,
  type QueuedMessage,
  type PermissionMode,
  type PullRequestLink,
  type PullRequestList,
  type PullRequestListTab,
  type PullRequestSnapshot,
  type PullRequestGuideState,
  type Bot,
  type BotConversationMessage,
  type BotTask,
  type ParamsOf,
} from '@jetty/shared/wire'
import { Context, Effect, FileSystem, Layer, Path, Queue, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import type { GuideMetrics } from './pr-guide'
import type { PullRequestWatchMemory } from './pull-request-watch'

import { normalizePath } from './fs-browse'
import { childReport, restartNote, type ReportOutcome } from './jetty-instructions'

export const DEFAULT_THREAD_TITLE = 'New thread'
const PERSIST_INTERVAL = '2 seconds'
const EVICT_AFTER_MS = 5 * 60_000

export type AppendedEvent = {
  seq: number
  ts: number
  event: ThreadEvent
  state: ThreadState
  prevStatus: SessionStatus
  thread: ThreadMeta
}

export type StoredPullRequestGuide = Omit<PullRequestGuideState, 'outdated'> & {
  model?: string
  metrics?: GuideMetrics
  createdAt: number
  updatedAt: number
}

type ProjectRow = {
  id: string
  path: string
  title: string
  created_at: number
  icon: string | null
}
type ThreadRow = {
  id: string
  project_id: string
  title: string
  status: SessionStatus
  queue_paused: number
  archived: number
  pinned: number
  ready_for_review: number
  updated_at: number
  turn_started_at: number | null
  turn_ended_at: number | null
  provider: string | null
  model: string | null
  effort: string | null
  fast: number | null
  parent_thread_id: string | null
  created_by: 'user' | 'agent'
  environment: 'local' | 'worktree'
  git_json: string | null
  worktree_json: string | null
  pending_messages: string
  awaiting_parent: number
  bot_id: string | null
}

type BotRow = {
  id: string
  name: string
  shape: Bot['shape']
  color: Bot['color']
  provider: Bot['provider']
  model: string
  effort: string | null
  fast: number
  project_id: string | null
  permission_mode: Bot['permissionMode']
  created_at: number
  seen_at: number
}

type BotTaskRow = {
  id: string
  bot_id: string
  title: string
  status: BotTask['status']
  note: string | null
  created_at: number
  updated_at: number
  closed_at: number | null
}

export type WorktreeRecord = {
  checkoutPath: string | null
  baseCommit: string
  branch: string | null
  temporaryBranch: string | null
  slot: number | null
  state: 'pending' | 'setting_up' | 'ready' | 'failed' | 'stopped'
  error: string | null
}

export type ThreadLoadout = { model?: string; effort?: EffortLevel; fast?: boolean }

const isEffort = Schema.is(EffortLevel)
const isProjectIcon = Schema.is(ProjectIcon)
const isModelRef = Schema.is(ModelRef)

export class StoreError extends Error {
  readonly _tag = 'StoreError'
  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'StoreError'
  }
}

function storeError(error: unknown) {
  return error instanceof StoreError
    ? error
    : new StoreError('internal', String(error), { cause: error })
}

function invalidEvent(error: unknown) {
  return new StoreError('invalid_params', String(error), { cause: error })
}

function rowToBotTask(row: BotTaskRow): BotTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.closed_at !== null ? { closedAt: row.closed_at } : {}),
  }
}

function rowToProject(row: ProjectRow): Project {
  const icon: unknown = row.icon && JSON.parse(row.icon)
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    createdAt: row.created_at,
    ...(isProjectIcon(icon) ? { icon } : {}),
  }
}

function publicProvider(value: string | null): ProviderId | undefined {
  if (value === 'claude' || value === 'codex' || value === 'grok') return value
  return undefined
}

function rowToThread(row: ThreadRow): ThreadMeta {
  const git = row.git_json
    ? (JSON.parse(row.git_json) as { branch?: string; dirty?: boolean })
    : null
  const provider = publicProvider(row.provider)
  const worktree = row.worktree_json ? (JSON.parse(row.worktree_json) as WorktreeRecord) : null
  return {
    id: row.id,
    projectId: row.project_id,
    environment: row.environment,
    ...(worktree?.checkoutPath ? { workingPath: worktree.checkoutPath } : {}),
    ...(git?.branch
      ? {
          git: { branch: git.branch, dirty: git.dirty ?? false },
        }
      : {}),
    ...(worktree
      ? { worktree: { state: worktree.state, error: worktree.error, branch: worktree.branch } }
      : {}),
    title: row.title,
    status: row.status,
    queuePaused: row.queue_paused !== 0,
    archived: row.archived !== 0,
    pinned: row.pinned !== 0,
    readyForReview: row.ready_for_review !== 0,
    ...(row.awaiting_parent ? { awaitingParent: true } : {}),
    pullRequests: [],
    updatedAt: row.updated_at,
    ...(row.turn_started_at === null ? {} : { turnStartedAt: row.turn_started_at }),
    ...(row.turn_ended_at === null ? {} : { turnEndedAt: row.turn_ended_at }),
    createdBy: row.created_by,
    ...(row.parent_thread_id ? { parentThreadId: row.parent_thread_id } : {}),
    ...(row.bot_id ? { botId: row.bot_id } : {}),
    pendingMessages: JSON.parse(row.pending_messages),
    ...(provider ? { provider } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(isEffort(row.effort) ? { effort: row.effort } : {}),
    ...(row.fast === null ? {} : { fast: row.fast !== 0 }),
  }
}

export type Store = Effect.Success<ReturnType<typeof createStore>>
export const Store = Context.Service<Store>('jetty/Store')

export function createStore() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const fs = yield* FileSystem.FileSystem
    const paths = yield* Path.Path
    const scope = yield* Effect.scope
    const queueChanges = yield* Queue.sliding<void>(1)
    const signalQueueChange = Queue.offer(queueChanges, undefined)
    const persistWake = yield* Queue.sliding<void>(1)
    // Reads and writes of a thread's state run inside SQL transactions, so they are serialized
    // with every event write and never observe an uncommitted one.
    const loaded = new Map<string, { state: ThreadState; persistedSeq: number; usedAt: number }>()
    // Queued messages a starting turn has taken: their text is already on its way to the agent,
    // so PR news and reports go to a new message instead of merging into one of these.
    const claimed = new Set<string>()

    type LinkRow = {
      thread_id: string
      repo: string
      number: number
      linked_at: number
      title: string | null
      state: string | null
      merged: number | null
      draft: number | null
      updated_at: string | null
      check_rollup: string | null
      failing_checks: number
      running_checks: number
      check_count: number | null
      checks_truncated: number
      review_decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
      mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null
      merge_state_status: string | null
      base_ref: string | null
      review_requests: number | null
    }

    function rowToLink(row: LinkRow): PullRequestLink {
      const state = row.merged
        ? ('merged' as const)
        : row.state === 'closed'
          ? ('closed' as const)
          : row.draft
            ? ('draft' as const)
            : ('open' as const)
      return {
        repo: row.repo,
        number: row.number,
        url: `https://github.com/${row.repo}/pull/${row.number}`,
        linkedAt: row.linked_at,
        ...(row.title
          ? {
              title: row.title,
              state,
              updatedAt: Date.parse(row.updated_at ?? ''),
              ...(state === 'open' ? readiness(row) : {}),
            }
          : {}),
      }
    }

    // What an open PR's readiness reads: its checks, reviews and GitHub's merge verdict.
    function readiness(row: LinkRow) {
      const checks =
        rollupChecks[
          displayedRollupState(
            {
              failed: row.failing_checks,
              running: row.running_checks,
              total: row.check_count ?? 0,
            },
            row.check_rollup ?? '',
            row.checks_truncated === 1
          )
        ]
      return {
        ...(checks ? { checks } : {}),
        ...(checks === 'failure' && row.failing_checks
          ? { failingChecks: row.failing_checks }
          : {}),
        ...(row.review_decision ? { reviewDecision: row.review_decision } : {}),
        ...(row.mergeable ? { mergeable: row.mergeable } : {}),
        ...(row.merge_state_status ? { mergeStateStatus: row.merge_state_status } : {}),
        ...(row.base_ref ? { baseRef: row.base_ref } : {}),
        ...(row.review_requests ? { reviewRequestCount: row.review_requests } : {}),
      }
    }

    const linkRows = sql`SELECT l.*, json_extract(p.data_json, '$.pull.title') AS title,
      json_extract(p.data_json, '$.pull.state') AS state,
      json_extract(p.data_json, '$.pull.merged') AS merged,
      json_extract(p.data_json, '$.pull.draft') AS draft,
      json_extract(p.data_json, '$.pull.updated_at') AS updated_at,
      json_extract(p.data_json, '$.checkRollupState') AS check_rollup,
      (SELECT count(*) FROM json_each(p.data_json, '$.checkRuns')
        WHERE json_extract(value, '$.conclusion') IN ${sql.in(failedCheckConclusions)}) AS failing_checks,
      (SELECT count(*) FROM json_each(p.data_json, '$.checkRuns')
        WHERE ifnull(json_extract(value, '$.status'), '') != 'completed'
          AND ifnull(json_extract(value, '$.conclusion'), '') NOT IN ${sql.in(failedCheckConclusions)}) AS running_checks,
      json_array_length(p.data_json, '$.checkRuns') AS check_count,
      EXISTS (SELECT 1 FROM json_each(p.data_json, '$.truncatedConnections') WHERE value = 'checkRuns') AS checks_truncated,
      json_extract(p.data_json, '$.reviewDecision') AS review_decision,
      json_extract(p.data_json, '$.mergeable') AS mergeable,
      json_extract(p.data_json, '$.mergeStateStatus') AS merge_state_status,
      json_extract(p.data_json, '$.pull.base.ref') AS base_ref,
      json_array_length(p.data_json, '$.reviewRequests') AS review_requests FROM thread_pull_requests l
      JOIN pull_requests p ON p.repo = l.repo AND p.number = l.number`

    function getLinks(threadId: string) {
      return sql<LinkRow>`${linkRows} WHERE l.thread_id = ${threadId} ORDER BY l.linked_at DESC`.pipe(
        Effect.map((rows) => rows.map(rowToLink))
      )
    }

    function getThread(threadId: string) {
      return Effect.gen(function* () {
        const [row] = yield* sql<ThreadRow>`SELECT * FROM threads WHERE id = ${threadId}`
        return row ? { ...rowToThread(row), pullRequests: yield* getLinks(threadId) } : null
      }).pipe(Effect.mapError(storeError))
    }

    function requireThread(threadId: string) {
      return getThread(threadId).pipe(
        Effect.flatMap((thread) =>
          thread
            ? Effect.succeed(thread)
            : Effect.fail(new StoreError('not_found', `Thread ${threadId} not found`))
        )
      )
    }

    function lockTitle(threadId: string, title: string) {
      return Effect.gen(function* () {
        const existing = yield* requireThread(threadId)
        const now = Date.now()
        yield* sql`UPDATE threads SET title = ${title}, title_locked = 1, updated_at = ${now} WHERE id = ${threadId}`
        return { ...existing, title, updatedAt: now }
      }).pipe(sql.withTransaction, Effect.mapError(storeError))
    }

    function eventsAfter(threadId: string, afterSeq: number) {
      return Effect.gen(function* () {
        const rows = yield* sql<{
          seq: number
          ts: number
          payload_json: string
        }>`SELECT seq, ts, payload_json FROM thread_events WHERE thread_id = ${threadId} AND seq > ${afterSeq} ORDER BY seq`
        return yield* Effect.forEach(rows, (row) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadEvent))(row.payload_json).pipe(
            Effect.map((event) => ({ seq: row.seq, ts: row.ts, event }))
          )
        )
      })
    }

    function loadThread(threadId: string) {
      return Effect.gen(function* () {
        const cached = loaded.get(threadId)
        if (cached) {
          cached.usedAt = Date.now()
          return cached
        }
        const [row] = yield* sql<{
          state_json: string
        }>`SELECT state_json FROM thread_states WHERE thread_id = ${threadId}`
        const snapshot = row
          ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadState))(row.state_json)
          : emptyThread
        let state = snapshot
        for (const event of yield* eventsAfter(threadId, snapshot.lastSeq))
          state = yield* Effect.try({ try: () => applyEvent(state, event), catch: storeError })
        const entry = { state, persistedSeq: snapshot.lastSeq, usedAt: Date.now() }
        loaded.set(threadId, entry)
        return entry
      })
    }

    // A failed transaction drops the threads it changed; they reload from the rolled-back rows.
    // The check sits outside the transaction, so a failed COMMIT drops them too.
    function atomically<A, E, R>(effect: Effect.Effect<A, E, R>) {
      return Effect.suspend(() => {
        const before = new Map(Array.from(loaded, ([id, entry]) => [id, entry.state]))
        return effect.pipe(
          sql.withTransaction,
          Effect.onError(() =>
            Effect.sync(() => {
              for (const [id, entry] of loaded)
                if (before.get(id) !== entry.state) loaded.delete(id)
            })
          )
        )
      })
    }

    function getThreadState(threadId: string) {
      return loadThread(threadId).pipe(
        Effect.map((entry) => entry.state),
        sql.withTransaction,
        Effect.mapError(storeError)
      )
    }

    function getBotConversation(botId: string, otherBotId: string) {
      return Effect.gen(function* () {
        const messages: BotConversationMessage[] = []
        for (const [from, to] of [
          [botId, otherBotId],
          [otherBotId, botId],
        ] as const) {
          const state = yield* getThreadState(to)
          const delivered = new Set<string>()
          for (const item of state.items) {
            if (
              item.kind !== 'user_message' ||
              item.from?.threadId !== from ||
              item.agentId !== undefined
            )
              continue
            delivered.add(item.id)
            messages.push({
              id: item.id,
              from,
              text: item.text,
              createdAt: item.createdAt,
              attachments: item.attachments ?? [],
            })
          }
          for (const message of (yield* requireThread(to)).pendingMessages ?? []) {
            if (message.from?.threadId !== from || delivered.has(message.id)) continue
            messages.push({
              id: message.id,
              from,
              text: message.text,
              createdAt: message.createdAt,
              attachments: message.attachments ?? [],
            })
          }
        }
        return messages.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      }).pipe(sql.withTransaction, Effect.mapError(storeError))
    }

    function writeState(threadId: string, state: ThreadState) {
      return Effect.gen(function* () {
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(ThreadState))(state)
        yield* sql`INSERT INTO thread_states (thread_id, state_json, last_seq)
          VALUES (${threadId}, ${json}, ${state.lastSeq})
          ON CONFLICT(thread_id) DO UPDATE SET state_json = excluded.state_json, last_seq = excluded.last_seq`
      })
    }

    function isDirty(entry: { state: ThreadState; persistedSeq: number }) {
      return entry.state.lastSeq !== entry.persistedSeq
    }

    const persistDirty = Effect.suspend(() =>
      Effect.forEach(
        Array.from(loaded).filter(([, entry]) => isDirty(entry)),
        ([threadId]) =>
          Effect.gen(function* () {
            const entry = loaded.get(threadId)
            if (!entry || !isDirty(entry)) return
            yield* writeState(threadId, entry.state)
            return { entry, seq: entry.state.lastSeq }
          }).pipe(
            sql.withTransaction,
            Effect.map((written) => {
              if (written) written.entry.persistedSeq = written.seq
            }),
            Effect.catchCause((cause) => Effect.logWarning(cause))
          ),
        { discard: true }
      )
    )

    const evictIdle = Effect.sync(() => {
      const cutoff = Date.now() - EVICT_AFTER_MS
      for (const [threadId, entry] of loaded)
        if (entry.usedAt < cutoff && !isDirty(entry)) loaded.delete(threadId)
    })

    yield* Effect.addFinalizer(() => persistDirty)
    yield* Queue.take(persistWake).pipe(
      Effect.timeoutOption(PERSIST_INTERVAL),
      Effect.andThen(persistDirty),
      Effect.andThen(evictIdle),
      Effect.forever,
      Effect.forkIn(scope)
    )

    function updateQueue(threadId: string, messages: readonly QueuedMessage[]) {
      return sql`UPDATE threads SET pending_messages = ${JSON.stringify(messages)} WHERE id = ${threadId}`
    }

    // `at` places the message at that index (0 for the front); by default it goes last.
    function enqueue(threadId: string, message: QueuedMessage, at = Infinity) {
      return Effect.gen(function* () {
        const thread = yield* requireThread(threadId)
        if (thread.archived)
          return yield* Effect.fail(new StoreError('not_found', 'Thread is archived'))
        if (message.hop > 20)
          return yield* Effect.fail(
            new StoreError(
              'invalid_params',
              'Stopped: this chain of messages between threads passed 20 hops, which looks like a loop'
            )
          )
        const pending = thread.pendingMessages ?? []
        if (pending.some((queued) => queued.id === message.id))
          return yield* Effect.fail(new StoreError('conflict', 'This message is already queued'))
        yield* sql`INSERT OR IGNORE INTO message_receipts VALUES (${threadId}, ${message.id})`
        yield* updateQueue(threadId, [...pending.slice(0, at), message, ...pending.slice(at)])
        return yield* requireThread(threadId)
      })
    }

    function removeQueued(threadId: string, messageId: string) {
      return Effect.gen(function* () {
        const thread = yield* requireThread(threadId)
        yield* updateQueue(
          threadId,
          (thread.pendingMessages ?? []).filter((m) => m.id !== messageId)
        )
      })
    }

    // Every attachment a thread still shows or has queued; any other file can go.
    function heldAttachments() {
      return sql<{ id: string }>`SELECT attachment_id AS id FROM attachment_refs
        UNION SELECT json_extract(a.value, '$.id') FROM threads t, json_each(t.pending_messages) m,
          json_each(m.value, '$.attachments') a`.pipe(
        Effect.map((rows) => new Set(rows.map((row) => row.id)))
      )
    }

    function unheld(ids: readonly string[]) {
      return Effect.gen(function* () {
        if (!ids.length) return []
        const held = yield* heldAttachments()
        return [...new Set(ids)].filter((id) => !held.has(id))
      })
    }

    function notifiesParent(threadId: string) {
      return sql<{
        notify_parent: number
      }>`SELECT notify_parent FROM threads WHERE id = ${threadId}`.pipe(
        Effect.map(([row]) => row?.notify_parent === 1)
      )
    }

    // Time a child spent in turns since its last report; waiting on its own children doesn't count.
    function workedSeconds(threadId: string) {
      return Effect.gen(function* () {
        const [last] = yield* sql<{
          request_id: string
        }>`SELECT request_id FROM orchestration_requests
          WHERE caller_id = ${threadId} AND operation = 'report' ORDER BY rowid DESC LIMIT 1`
        const lastTurn = last?.request_id.split(':').at(-1)
        const [since] = lastTurn
          ? yield* sql<{ seq: number }>`SELECT seq FROM thread_events WHERE thread_id = ${threadId}
              AND json_extract(payload_json, '$.turnId') = ${lastTurn}
              AND json_extract(payload_json, '$.type') IN ('turn.completed', 'turn.failed')`
          : []
        const events = yield* sql<{ ts: number; type: string }>`SELECT ts,
            json_extract(payload_json, '$.type') AS type FROM thread_events
          WHERE thread_id = ${threadId} AND seq > ${since?.seq ?? 0}
            AND json_extract(payload_json, '$.type') IN ('turn.started', 'turn.completed', 'turn.failed')
          ORDER BY seq`
        let worked = 0
        let started: number | undefined
        for (const { ts, type } of events) {
          if (type === 'turn.started') started = ts
          else if (started !== undefined) {
            worked += ts - started
            started = undefined
          }
        }
        return Math.round(worked / 1000)
      })
    }

    function latestFinishedTurn(threadId: string) {
      return sql<{
        turn_id: string
        hop: number
        initiator_thread_id: string | null
        payload_json: string
      }>`SELECT t.turn_id, t.hop, t.initiator_thread_id, e.payload_json
        FROM thread_events e JOIN orchestration_turns t
          ON t.turn_id = json_extract(e.payload_json, '$.turnId')
        WHERE e.thread_id = ${threadId}
          AND json_extract(e.payload_json, '$.type') IN ('turn.completed', 'turn.failed')
        ORDER BY e.seq DESC LIMIT 1`.pipe(Effect.map(([turn]) => turn))
    }

    function parentQuestion(threadId: string) {
      return sql<{
        parent_question: string | null
      }>`SELECT parent_question FROM threads WHERE id = ${threadId}`.pipe(
        Effect.map(([row]) => row?.parent_question ?? null)
      )
    }

    // A question from ask_parent is reported in place of the turn's final message. It reaches the
    // parent however the turn started and even when the parent isn't notified, since it was asked,
    // and as soon as the turn ends: a report also waits for background work and busy children.
    function reportSettledChild(threadId: string, working = false) {
      return Effect.gen(function* () {
        const thread = yield* requireThread(threadId)
        if (thread.createdBy !== 'agent' || !thread.parentThreadId) return { delivered: false }
        const question = yield* parentQuestion(threadId)
        if (!question && (working || !(yield* notifiesParent(threadId))))
          return { delivered: false }
        const { state } = yield* loadThread(threadId)
        if (state.activeTurnId) return { delivered: false }
        const turn = yield* latestFinishedTurn(threadId)
        if (!turn || (!question && turn.initiator_thread_id !== thread.parentThreadId))
          return { delivered: false }
        const event = JSON.parse(turn.payload_json) as Extract<
          ThreadEvent,
          { type: 'turn.completed' | 'turn.failed' }
        >
        const paused = heldByRestarts(state.items)
        if (event.type === 'turn.failed' && event.error === 'server_restarted' && !paused)
          return { delivered: false }
        if (!question && !paused && thread.pendingMessages?.length) return { delivered: false }
        if (
          !question &&
          state.items.some(
            (item) =>
              (item.kind === 'subagent' || item.kind === 'workflow') && item.status === 'running'
          )
        )
          return { delivered: false }
        // A turn that ended asking the user (Codex's async questions) carries on with their answer.
        if (
          !question &&
          state.items.some(
            (item) =>
              item.kind === 'question' &&
              item.turnId === turn.turn_id &&
              item.delivery === 'async' &&
              !item.answers &&
              !item.dismissed
          )
        )
          return { delivered: false }
        const reportId = `report:${threadId}:${turn.turn_id}`
        const [existing] = yield* sql`SELECT 1 FROM orchestration_requests
          WHERE caller_id = ${threadId} AND request_id = ${reportId} AND operation = 'report'`
        if (existing && !question) return { delivered: false }
        const parent = yield* getThread(thread.parentThreadId)
        const hop = turn.hop + 1
        if (!parent || parent.archived || hop > 20) {
          const reason =
            hop > 20
              ? 'message hop limit exceeded'
              : parent
                ? 'parent is archived'
                : 'parent is missing'
          yield* Effect.logWarning(`Report from ${threadId} dropped: ${reason}`)
          const note = yield* append(threadId, {
            type: 'item.started',
            item: {
              id: newId(),
              turnId: turn.turn_id,
              createdAt: Date.now(),
              kind: 'error',
              message: `Report to parent was not delivered: ${reason}.`,
            },
          })
          yield* sql`INSERT OR IGNORE INTO orchestration_requests VALUES (${threadId}, ${reportId}, 'report', ${JSON.stringify({ threadId: thread.parentThreadId })})`
          yield* sql`UPDATE threads SET parent_question = NULL WHERE id = ${threadId}`
          return { delivered: false, note }
        }
        // The restart guard can hold a turn that completed while its background work ran.
        const outcome: ReportOutcome = question
          ? { type: 'asked', question }
          : heldByRestarts(state.items)
            ? { type: 'paused' }
            : event.type === 'turn.completed'
              ? { type: 'finished' }
              : event.error === 'interrupted'
                ? { type: 'interrupted' }
                : { type: 'failed', error: event.error }
        const lastWork = state.items.findLastIndex(
          (item) =>
            item.turnId === turn.turn_id &&
            !item.agentId &&
            (item.kind === 'tool_call' || item.kind === 'subagent' || item.kind === 'workflow')
        )
        const final = state.items
          .slice(lastWork + 1)
          .filter(
            (item) =>
              item.turnId === turn.turn_id &&
              item.kind === 'assistant_message' &&
              !item.agentId &&
              !item.private &&
              item.text.trim()
          )
        const text = childReport({
          threadId,
          title: thread.title,
          outcome,
          branch:
            thread.environment === 'worktree'
              ? (thread.worktree?.branch ?? thread.git?.branch ?? 'unavailable')
              : null,
          message: final
            .map((item) => (item.kind === 'assistant_message' ? item.text.trim() : ''))
            .join('\n\n'),
          messageId: final.at(-1)?.id,
        })
        const summary = {
          threadId,
          title: thread.title,
          outcome: outcome.type,
          seconds: yield* workedSeconds(threadId),
          ...(question && { question }),
        }
        // Reports waiting in the parent's queue merge into one message, which then comes from Jetty.
        const batch = parent.pendingMessages?.find(
          (message) => message.kind === 'report' && !claimed.has(message.id)
        )
        const messageId = batch?.id ?? reportId
        if (batch)
          yield* updateQueue(
            parent.id,
            (parent.pendingMessages ?? []).map((message) =>
              message.id === batch.id
                ? {
                    ...message,
                    text: `${message.text}\n\n---\n\n${text}`,
                    from: { threadId: parent.id, title: 'Jetty' },
                    reports: [...(message.reports ?? []), summary],
                    hop: Math.max(message.hop, hop),
                  }
                : message
            )
          )
        else
          yield* enqueue(parent.id, {
            id: messageId,
            text,
            createdAt: Date.now(),
            hop,
            from: { threadId, title: thread.title },
            kind: 'report',
            reports: [summary],
          })
        yield* sql`INSERT OR IGNORE INTO orchestration_requests VALUES (${threadId}, ${reportId}, 'report', ${JSON.stringify({ threadId: parent.id, messageId })})`
        if (!question) return { delivered: true }
        yield* sql`UPDATE threads SET parent_question = NULL, awaiting_parent = 1 WHERE id = ${threadId}`
        return { delivered: true, asked: true }
      }).pipe(atomically, Effect.mapError(storeError))
    }

    function append(threadId: string, event: ThreadEvent) {
      return Effect.gen(function* () {
        const [threadRow] = yield* sql<ThreadRow>`SELECT * FROM threads WHERE id = ${threadId}`
        if (!threadRow)
          return yield* Effect.fail(new StoreError('not_found', `Thread ${threadId} not found`))
        const thread = rowToThread(threadRow)
        const validated = yield* Schema.decodeUnknownEffect(ThreadEvent)(event).pipe(
          Effect.mapError(invalidEvent)
        )
        const entry = yield* loadThread(threadId)
        const prev = entry.state
        const seq = prev.lastSeq + 1
        const ts = Date.now()
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(ThreadEvent))(validated)
        yield* sql`INSERT INTO thread_events (thread_id, seq, ts, payload_json) VALUES (${threadId}, ${seq}, ${ts}, ${json})`
        const state = yield* Effect.try({
          try: () => applyEvent(prev, { seq, ts, event: validated }),
          catch: invalidEvent,
        })
        entry.state = state
        if (validated.type === 'item.started') {
          const item = validated.item
          const media =
            item.kind === 'user_message'
              ? item.attachments
              : item.kind === 'image_gallery'
                ? item.images
                : item.kind === 'video'
                  ? [item.video]
                  : []
          for (const attachment of media)
            yield* sql`INSERT OR IGNORE INTO attachment_refs (thread_id, attachment_id, metadata_json)
              VALUES (${threadId}, ${attachment.id}, ${JSON.stringify(attachment)})`
        }
        const turnStartedAt =
          validated.type === 'turn.started' ? ts : (thread.turnStartedAt ?? null)
        const turnEndedAt =
          validated.type === 'turn.started'
            ? null
            : validated.type === 'turn.completed' || validated.type === 'turn.failed'
              ? ts
              : (thread.turnEndedAt ?? null)
        yield* sql`UPDATE threads SET status = ${state.status}, updated_at = ${ts},
          turn_started_at = ${turnStartedAt}, turn_ended_at = ${turnEndedAt} WHERE id = ${threadId}`
        return {
          seq,
          ts,
          event: validated,
          state,
          prevStatus: prev.status,
          thread: {
            ...thread,
            pullRequests: [],
            status: state.status,
            updatedAt: ts,
            turnStartedAt: turnStartedAt ?? undefined,
            turnEndedAt: turnEndedAt ?? undefined,
          },
        } satisfies AppendedEvent
      })
    }

    function turnContext(threadId: string) {
      return Effect.gen(function* () {
        const { state } = yield* loadThread(threadId)
        if (!state.activeTurnId)
          return yield* Effect.fail(
            new StoreError(
              'conflict',
              "This only works during your own turn, and a background task can't call it after the turn has ended"
            )
          )
        const [turn] = yield* sql<{
          hop: number
          created_count: number
        }>`SELECT hop, created_count FROM orchestration_turns WHERE turn_id = ${state.activeTurnId}`
        return {
          turnId: state.activeTurnId,
          hop: turn?.hop ?? 0,
          createdCount: turn?.created_count ?? 0,
        }
      }).pipe(Effect.mapError(storeError))
    }

    function listBotTasks(botId: string) {
      return sql<BotTaskRow>`SELECT * FROM bot_tasks WHERE bot_id = ${botId}
        AND (status IN ('todo', 'in_progress') OR closed_at >= ${Date.now() - CLOSED_TASK_SHOWN_MS})
        ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1
          WHEN 'done' THEN 2 WHEN 'dropped' THEN 3 END, created_at, id`.pipe(
        Effect.map((rows) => rows.map(rowToBotTask)),
        Effect.mapError(storeError)
      )
    }

    function readBot(threadId: string) {
      return Effect.gen(function* () {
        const [row] = yield* sql<BotRow>`SELECT * FROM bots WHERE id = ${threadId}`
        if (!row) return null
        const state = yield* getThreadState(row.id)
        const [waiting] = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM threads
            WHERE bot_id = ${row.id} AND id != ${row.id} AND status = 'awaiting_approval'`
        const needsYou =
          state.items.some(
            (item) =>
              (item.kind === 'question' && !item.answers && !item.dismissed) ||
              (item.kind === 'approval' && !item.decision)
          ) || (waiting?.count ?? 0) > 0
        const active = state.activeTurnId !== null
        const current = state.items.filter((item) => item.turnId === state.activeTurnId)
        const newest = [...current].reverse().find((item) => !item.agentId)
        const turn = state.activeTurnId && botTurnActivity(current, state.activeTurnId)
        const activity: Bot['activity'] =
          !active || needsYou || !turn
            ? 'idle'
            : newest?.kind === 'compaction' && newest.status === 'running'
              ? 'tidying'
              : turn === 'quiet'
                ? 'idle'
                : turn
        return {
          id: row.id,
          name: row.name,
          shape: row.shape,
          color: row.color,
          provider: row.provider,
          model: row.model,
          ...(isEffort(row.effort) ? { effort: row.effort } : {}),
          fast: row.fast !== 0,
          projectId: row.project_id,
          permissionMode: row.permission_mode,
          createdAt: row.created_at,
          tasks: yield* listBotTasks(row.id),
          activity,
          needsYou,
          failed: state.lastTurnOutcome === 'failed',
          unread:
            !active &&
            state.items.some(
              (item) =>
                item.kind === 'assistant_message' &&
                !item.private &&
                item.createdAt > row.seen_at &&
                shownInBotChat(item)
            ),
        } satisfies Bot
      }).pipe(Effect.mapError(storeError))
    }

    function createProjectResult(path: string) {
      return Effect.gen(function* () {
        const resolved = normalizePath(path)
        const isDir = yield* fs.stat(resolved).pipe(
          Effect.map((stat) => stat.type === 'Directory'),
          Effect.catch(() => Effect.succeed(false))
        )
        if (!isDir)
          return yield* Effect.fail(
            new StoreError('invalid_params', `Not an existing directory: ${path}`)
          )
        const normalized = yield* fs.realPath(resolved)
        return yield* Effect.gen(function* () {
          const rows = yield* sql<ProjectRow>`SELECT * FROM projects WHERE path = ${normalized}`
          if (rows[0]) return { project: rowToProject(rows[0]), created: false }
          const project: Project = {
            id: newId(),
            path: normalized,
            title: paths.basename(normalized) || normalized,
            createdAt: Date.now(),
          }
          yield* sql`INSERT INTO projects (id, path, title, created_at) VALUES (${project.id}, ${project.path}, ${project.title}, ${project.createdAt})`
          return { project, created: true }
        }).pipe(sql.withTransaction)
      }).pipe(Effect.mapError(storeError))
    }

    return {
      queueChanges,
      listBotTasks,
      addBotTask(
        botId: string,
        input: Pick<BotTask, 'title'> & Partial<Pick<BotTask, 'status' | 'note'>>
      ) {
        return Effect.gen(function* () {
          const id = newId()
          const now = Date.now()
          const status = input.status ?? 'todo'
          const closedAt = status === 'done' || status === 'dropped' ? now : null
          const [row] = yield* sql<BotTaskRow>`INSERT INTO bot_tasks
            (id, bot_id, title, status, note, created_at, updated_at, closed_at)
            VALUES (${id}, ${botId}, ${input.title}, ${status}, ${input.note || null},
              ${now}, ${now}, ${closedAt}) RETURNING *`
          return rowToBotTask(row!)
        }).pipe(Effect.mapError(storeError))
      },
      updateBotTask(
        botId: string,
        id: string,
        input: Partial<Pick<BotTask, 'title' | 'status' | 'note'>>
      ) {
        return Effect.gen(function* () {
          const [previous] = yield* sql<BotTaskRow>`SELECT * FROM bot_tasks
            WHERE id = ${id} AND bot_id = ${botId}`
          if (!previous)
            return yield* Effect.fail(new StoreError('not_found', `No task ${id} on your list`))
          const now = Date.now()
          const status = input.status ?? previous.status
          const closedAt =
            status === 'done' || status === 'dropped' ? (previous.closed_at ?? now) : null
          const note = input.note === undefined ? previous.note : input.note || null
          const [row] = yield* sql<BotTaskRow>`UPDATE bot_tasks
            SET title = ${input.title ?? previous.title}, status = ${status}, note = ${note},
              updated_at = ${now}, closed_at = ${closedAt}
            WHERE id = ${id} AND bot_id = ${botId} RETURNING *`
          return rowToBotTask(row!)
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      createBotRecord(input: ParamsOf<'bot.create'>, home: string) {
        return Effect.gen(function* () {
          const existing = yield* sql<BotRow>`SELECT * FROM bots WHERE id = ${input.id}`
          if (existing.length) return false
          const now = Date.now()
          yield* sql`INSERT INTO projects (id, path, title, created_at, bot_id)
            VALUES (${input.id}, ${home}, ${input.name}, ${now}, ${input.id})`
          yield* sql`INSERT INTO threads (id, project_id, title, status, updated_at, bot_id,
            provider, model, effort, fast, permission_mode)
            VALUES (${input.id}, ${input.id}, ${input.name}, 'idle', ${now}, ${input.id},
              ${input.provider}, ${input.model}, ${input.effort ?? null}, ${input.fast ? 1 : 0},
              ${input.permissionMode})`
          yield* sql`INSERT INTO bots (id, name, shape, color, provider, model, effort, fast,
            project_id, permission_mode, created_at, seen_at)
            VALUES (${input.id}, ${input.name}, ${input.shape}, ${input.color}, ${input.provider},
              ${input.model}, ${input.effort ?? null}, ${input.fast ? 1 : 0}, ${input.projectId},
              ${input.permissionMode}, ${now}, ${now})`
          return true
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      isBot(threadId: string) {
        return sql<{ id: string }>`SELECT id FROM bots WHERE id = ${threadId}`.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(storeError)
        )
      },
      getBot(threadId: string) {
        return readBot(threadId)
      },
      setBotProjectIfUnset(threadId: string, projectId: string) {
        return sql`UPDATE bots SET project_id = ${projectId}
          WHERE id = ${threadId} AND project_id IS NULL`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      listBots() {
        return Effect.gen(function* () {
          const rows = yield* sql<{ id: string }>`SELECT id FROM bots ORDER BY created_at, id`
          const bots: Bot[] = []
          for (const row of rows) {
            const bot = yield* readBot(row.id)
            if (bot) bots.push(bot)
          }
          return bots
        }).pipe(Effect.mapError(storeError))
      },
      markBotSeen(threadId: string) {
        return sql`UPDATE bots SET seen_at = ${Date.now()} WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      noteLiveBackground(threadId: string) {
        return sql`INSERT OR IGNORE INTO live_background (thread_id) VALUES (${threadId})`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      clearLiveBackground(threadId: string) {
        return sql`DELETE FROM live_background WHERE thread_id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      // One line per thread, then the flag is gone, so the next boot doesn't repeat it.
      stoppedBackground() {
        return Effect.gen(function* () {
          const rows = yield* sql<{ thread_id: string }>`SELECT thread_id FROM live_background`
          for (const row of rows) {
            const [thread] = yield* sql<{
              id: string
            }>`SELECT id FROM threads WHERE id = ${row.thread_id}`
            if (thread)
              yield* append(row.thread_id, {
                type: 'item.started',
                item: {
                  id: newId(),
                  turnId: newId(),
                  createdAt: Date.now(),
                  kind: 'background_stopped',
                },
              })
            yield* sql`DELETE FROM live_background WHERE thread_id = ${row.thread_id}`
          }
        }).pipe(atomically, Effect.mapError(storeError))
      },
      // A clean exit leaves `cleanShutdown` in settings. Missing, this start counts: a crash,
      // kill -9, or power loss. The row is consumed either way, so the next start is judged alone.
      recordServerStart(startedAt: number, windowMs: number) {
        return Effect.gen(function* () {
          const [marked] = yield* sql<{
            value_json: string
          }>`SELECT value_json FROM settings WHERE key = 'cleanShutdown'`
          yield* sql`DELETE FROM settings WHERE key = 'cleanShutdown'`
          yield* sql`DELETE FROM server_starts WHERE started_at < ${startedAt - windowMs}`
          if (marked?.value_json !== 'true')
            yield* sql`INSERT INTO server_starts (started_at) VALUES (${startedAt})`
          const [row] = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM server_starts
            WHERE started_at >= ${startedAt - windowMs} AND started_at <= ${startedAt}`
          return row!.count
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      isQueuePaused(threadId: string) {
        return sql<{
          queue_paused: number
        }>`SELECT queue_paused FROM threads WHERE id = ${threadId}`.pipe(
          Effect.map((rows) => rows[0]?.queue_paused === 1),
          Effect.mapError(storeError)
        )
      },
      setThreadGit(threadId: string, git: { branch: string; dirty: boolean }) {
        return sql`UPDATE threads SET git_json = json_patch(COALESCE(git_json, '{}'), ${JSON.stringify(git)}) WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      captureLocalBase(threadId: string, baseCommit: string) {
        return sql`UPDATE threads SET git_json = json_set(COALESCE(git_json, '{}'), '$.baseCommit', ${baseCommit}) WHERE id = ${threadId} AND environment = 'local' AND json_extract(git_json, '$.baseCommit') IS NULL`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      getThreadBaseCommit(threadId: string) {
        return sql<{
          base_commit: string | null
        }>`SELECT COALESCE(json_extract(worktree_json, '$.baseCommit'), json_extract(git_json, '$.baseCommit')) AS base_commit FROM threads WHERE id = ${threadId}`.pipe(
          Effect.map((rows) => rows[0]?.base_commit ?? undefined),
          Effect.mapError(storeError)
        )
      },
      getBranchPrefix() {
        return sql<{
          value_json: string
        }>`SELECT value_json FROM settings WHERE key = 'branchPrefix'`.pipe(
          Effect.map((rows) => (rows[0] ? (JSON.parse(rows[0].value_json) as string) : 'jetty')),
          Effect.mapError(storeError)
        )
      },
      setBranchPrefix(prefix: string) {
        return Effect.gen(function* () {
          if (
            !/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/.test(prefix) ||
            prefix.length > 100
          )
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                'Use letters, digits, hyphens, underscores and single slashes for the branch prefix'
              )
            )
          yield* sql`INSERT INTO settings (key, value_json) VALUES ('branchPrefix', ${JSON.stringify(prefix)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
        }).pipe(Effect.mapError(storeError))
      },
      // A worktree thread starts from a resolved base commit; everything else fills in at first send.
      setThreadEnvironment(threadId: string, baseCommit?: string) {
        const worktree: WorktreeRecord | null = baseCommit
          ? {
              checkoutPath: null,
              baseCommit,
              branch: null,
              temporaryBranch: null,
              slot: null,
              state: 'pending',
              error: null,
            }
          : null
        return sql`UPDATE threads SET environment = ${worktree ? 'worktree' : 'local'}, worktree_json = ${worktree && JSON.stringify(worktree)} WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      getWorktree(threadId: string) {
        return sql<{
          worktree_json: string | null
        }>`SELECT worktree_json FROM threads WHERE id = ${threadId}`.pipe(
          Effect.map((rows) =>
            rows[0]?.worktree_json ? (JSON.parse(rows[0].worktree_json) as WorktreeRecord) : null
          ),
          Effect.mapError(storeError)
        )
      },
      saveWorktree(threadId: string, record: WorktreeRecord) {
        return sql`UPDATE threads SET worktree_json = ${JSON.stringify(record)} WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      allocateWorktreeSlot(threadId: string) {
        return Effect.gen(function* () {
          const rows = yield* sql<{
            slot: number
          }>`SELECT json_extract(worktree_json, '$.slot') AS slot FROM threads WHERE worktree_json IS NOT NULL AND id != ${threadId}`
          const occupied = new Set(rows.map((row) => row.slot))
          let slot = 0
          while (occupied.has(slot)) slot++
          yield* sql`UPDATE threads SET worktree_json = json_set(worktree_json, '$.slot', ${slot}) WHERE id = ${threadId}`
          return slot
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      listWorktrees() {
        return sql<{
          id: string
          worktree_json: string
        }>`SELECT id, worktree_json FROM threads WHERE worktree_json IS NOT NULL`.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              threadId: row.id,
              record: JSON.parse(row.worktree_json) as WorktreeRecord,
            }))
          ),
          Effect.mapError(storeError)
        )
      },
      getTitleModel() {
        return sql<{
          key: string
          value_json: string
        }>`SELECT key, value_json FROM settings WHERE key IN ('utility_model', 'utility_effort')`.pipe(
          Effect.map((rows): TitleModel => {
            const value = (key: string): unknown => {
              const row = rows.find((candidate) => candidate.key === key)
              return row && JSON.parse(row.value_json)
            }
            const model = value('utility_model')
            const effort = value('utility_effort')
            return {
              model: isModelRef(model) ? model : null,
              ...(isEffort(effort) ? { effort } : {}),
            }
          }),
          Effect.mapError(storeError)
        )
      },
      setTitleModel({ model, effort }: TitleModel) {
        const write = (key: string, value: unknown) =>
          value === undefined || value === null
            ? sql`DELETE FROM settings WHERE key = ${key}`
            : sql`INSERT INTO settings (key, value_json) VALUES (${key}, ${JSON.stringify(value)})
                ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`
        return Effect.all([write('utility_model', model), write('utility_effort', effort)]).pipe(
          sql.withTransaction,
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      getAgentBehaviours() {
        return sql<{
          key: string
          value_json: string
        }>`SELECT key, value_json FROM settings WHERE key LIKE 'agent_behaviour.%'`.pipe(
          Effect.map(
            (rows) =>
              Object.fromEntries(
                agentBehaviours.map(({ key, defaultEnabled }) => {
                  const row = rows.find((candidate) => candidate.key === `agent_behaviour.${key}`)
                  const value: unknown = row && JSON.parse(row.value_json)
                  return [key, typeof value === 'boolean' ? value : defaultEnabled]
                })
              ) as AgentBehaviours
          ),
          Effect.mapError(storeError)
        )
      },
      setAgentBehaviour(key: AgentBehaviourKey, enabled: boolean) {
        return sql`INSERT INTO settings (key, value_json)
          VALUES (${`agent_behaviour.${key}`}, ${JSON.stringify(enabled)})
          ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      setQueuePaused(threadId: string, paused: boolean) {
        return sql`UPDATE threads SET queue_paused = ${paused ? 1 : 0} WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      transaction<A, E, R>(effect: Effect.Effect<A, E, R>) {
        return atomically(effect).pipe(Effect.mapError(storeError))
      },
      turnContext,
      // Whether the message was ever queued here, so a resend of one removed since stays removed.
      wasQueued(threadId: string, messageId: string) {
        return sql`SELECT 1 FROM message_receipts WHERE thread_id = ${threadId} AND message_id = ${messageId}`.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(storeError)
        )
      },
      enqueue(threadId: string, message: QueuedMessage, at?: number) {
        return enqueue(threadId, message, at).pipe(
          sql.withTransaction,
          Effect.tap(() => signalQueueChange),
          Effect.mapError(storeError)
        )
      },
      // A message id this thread ever queued is taken once, so a repeat racing the first, or one
      // after it ran or was removed, adds nothing: undefined.
      enqueueOnce(threadId: string, message: QueuedMessage) {
        return Effect.gen(function* () {
          const seen =
            yield* sql`SELECT 1 FROM message_receipts WHERE thread_id = ${threadId} AND message_id = ${message.id}`
          return seen.length ? undefined : yield* enqueue(threadId, message)
        }).pipe(
          sql.withTransaction,
          Effect.tap(() => signalQueueChange),
          Effect.mapError(storeError)
        )
      },
      // Reads a queued message for the turn starting with it and claims it in one transaction, so
      // nothing merges into it unseen. The turn releases it once delivered or given up.
      claimQueued(threadId: string, messageId: string) {
        return requireThread(threadId).pipe(
          Effect.map((thread) => {
            const message = thread.pendingMessages?.find((m) => m.id === messageId)
            if (message) claimed.add(message.id)
            return message
          }),
          sql.withTransaction,
          Effect.mapError(storeError)
        )
      },
      releaseQueued(messageId: string) {
        return Effect.sync(() => void claimed.delete(messageId))
      },
      // The PR watcher's message comes from Jetty; one still waiting in the queue takes the news too.
      queuePullRequestNews(threadId: string, text: string) {
        return Effect.gen(function* () {
          const thread = yield* requireThread(threadId)
          const waiting = thread.pendingMessages?.find(
            (m) => m.kind === 'pull_request' && !claimed.has(m.id)
          )
          if (waiting)
            yield* updateQueue(
              threadId,
              (thread.pendingMessages ?? []).map((m) =>
                m.id === waiting.id ? { ...m, text: `${m.text}\n\n${text}` } : m
              )
            )
          else
            yield* enqueue(threadId, {
              id: newId(),
              text,
              createdAt: Date.now(),
              hop: 0,
              from: { threadId, title: 'Jetty' },
              kind: 'pull_request',
            })
        }).pipe(
          sql.withTransaction,
          Effect.tap(() => signalQueueChange),
          Effect.mapError(storeError)
        )
      },
      editQueued(threadId: string, messageId: string, text?: string) {
        return Effect.gen(function* () {
          const thread = yield* requireThread(threadId)
          if (!(thread.pendingMessages ?? []).some((m) => m.id === messageId))
            return yield* Effect.fail(new StoreError('not_found', 'Queued message not found'))
          if (text !== undefined)
            yield* updateQueue(
              threadId,
              (thread.pendingMessages ?? []).map((m) =>
                m.id === messageId ? { ...m, text, editingUntil: undefined } : m
              )
            )
          else yield* removeQueued(threadId, messageId)
          return yield* requireThread(threadId)
        }).pipe(
          sql.withTransaction,
          Effect.tap(() => signalQueueChange),
          Effect.mapError(storeError)
        )
      },
      setQueuedEditing(threadId: string, messageId: string, editing: boolean) {
        return Effect.gen(function* () {
          const thread = yield* requireThread(threadId)
          if (!(thread.pendingMessages ?? []).some((m) => m.id === messageId))
            return yield* Effect.fail(new StoreError('not_found', 'Queued message not found'))
          yield* updateQueue(
            threadId,
            (thread.pendingMessages ?? []).map((m) =>
              m.id === messageId
                ? { ...m, editingUntil: editing ? Date.now() + 60_000 : undefined }
                : m
            )
          )
          return yield* requireThread(threadId)
        }).pipe(
          sql.withTransaction,
          Effect.tap(() => signalQueueChange),
          Effect.mapError(storeError)
        )
      },
      reportSettledChild,
      askParent(threadId: string, question: string) {
        return sql`UPDATE threads SET parent_question = COALESCE(parent_question || char(10) || char(10), '') || ${question} WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      suppressReport(threadId: string) {
        return Effect.gen(function* () {
          const thread = yield* requireThread(threadId)
          const { state } = yield* loadThread(threadId)
          const turnId = state.activeTurnId ?? (yield* latestFinishedTurn(threadId))?.turn_id
          if (!turnId || !thread.parentThreadId) return
          const reportId = `report:${threadId}:${turnId}`
          yield* sql`INSERT OR IGNORE INTO orchestration_requests VALUES (${threadId}, ${reportId}, 'report', ${JSON.stringify({ threadId: thread.parentThreadId })})`
          yield* sql`UPDATE threads SET parent_question = NULL, awaiting_parent = 0 WHERE id = ${threadId}`
        }).pipe(atomically, Effect.mapError(storeError))
      },
      threadTree(threadId: string) {
        return Effect.gen(function* () {
          yield* requireThread(threadId)
          const rows = yield* sql<ThreadRow>`WITH RECURSIVE tree AS (
            SELECT * FROM threads WHERE id = ${threadId}
            UNION ALL SELECT t.* FROM threads t JOIN tree p ON t.parent_thread_id = p.id
          ) SELECT * FROM tree`
          return rows.map(rowToThread)
        }).pipe(Effect.mapError(storeError))
      },
      archiveGroup(threadId: string) {
        return Effect.gen(function* () {
          const root = yield* requireThread(threadId)
          const rows =
            yield* sql<ThreadRow>`SELECT * FROM threads WHERE archive_group = ${threadId}`
          return [root, ...rows.filter((row) => row.id !== threadId).map(rowToThread)]
        }).pipe(Effect.mapError(storeError))
      },
      setArchiveGroup(threadIds: readonly string[], group: string | null) {
        return sql`UPDATE threads SET archive_group = ${group} WHERE id IN ${sql.in(threadIds)}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      beginDelivery(
        threadId: string,
        turnId: string,
        hop: number,
        messageId?: string,
        carriesOn = false
      ) {
        return Effect.gen(function* () {
          const entry = yield* loadThread(threadId)
          if (!entry.state.activeTurnId) {
            // The only state change without an event, so it is persisted right away.
            const state = { ...entry.state, activeTurnId: turnId, status: 'starting' as const }
            yield* writeState(threadId, state)
            entry.state = state
            entry.persistedSeq = state.lastSeq
            yield* sql`UPDATE threads SET status = 'starting', ready_for_review = 0, awaiting_parent = 0 WHERE id = ${threadId}`
          }
          const thread = yield* requireThread(threadId)
          const message = thread.pendingMessages?.find((m) => m.id === messageId)
          // A continuation, PR watcher news, a child's report or the user's answer to the turn's
          // question carries on the turn before it, so whoever started that turn still hears how
          // it ends; all but a report also keep its hop, so a chain through a PR wake still counts
          // towards the hop limit.
          const continues =
            carriesOn ||
            message?.carriesOn ||
            message?.kind === 'continuation' ||
            message?.kind === 'pull_request'
          const previous =
            continues || message?.kind === 'report'
              ? yield* latestFinishedTurn(threadId)
              : undefined
          const initiator = previous?.initiator_thread_id ?? message?.from?.threadId ?? null
          if (previous && continues) hop = previous.hop
          yield* sql`INSERT INTO orchestration_turns (turn_id, thread_id, hop, initiator_thread_id) VALUES (${turnId}, ${threadId}, ${hop}, ${initiator}) ON CONFLICT(turn_id) DO UPDATE SET hop = MAX(hop, excluded.hop)`
          if (messageId) yield* removeQueued(threadId, messageId)
        }).pipe(atomically, Effect.mapError(storeError))
      },
      // Jetty's note resuming a turn a restart cut off. A turn the agent never started also hands
      // over the message that opened it, which the agent never got.
      continuation(threadId: string, turnId: string, stoppedNames: readonly string[] = []) {
        return Effect.gen(function* () {
          const started = yield* sql`SELECT 1 FROM thread_events WHERE thread_id = ${threadId}
            AND json_extract(payload_json, '$.type') = 'turn.started'
            AND json_extract(payload_json, '$.turnId') = ${turnId} LIMIT 1`
          const { state } = yield* loadThread(threadId)
          const message = started.length
            ? undefined
            : state.items.find((item) => item.turnId === turnId && item.kind === 'user_message')
          if (message?.kind !== 'user_message') return restartNote(threadId, stoppedNames)
          const thread = yield* requireThread(threadId)
          const fromCreator =
            message.from !== undefined &&
            message.from.threadId === thread.parentThreadId &&
            (yield* notifiesParent(threadId))
          return restartNote(threadId, stoppedNames, { ...message, fromCreator })
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      // A turn the agent starts itself, woken by its background work, carries on the turn before it.
      carryOnTurn(threadId: string, turnId: string) {
        return Effect.gen(function* () {
          const previous = yield* latestFinishedTurn(threadId)
          if (previous)
            yield* sql`INSERT OR IGNORE INTO orchestration_turns (turn_id, thread_id, hop, initiator_thread_id) VALUES (${turnId}, ${threadId}, ${previous.hop}, ${previous.initiator_thread_id})`
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      getPermissionMode(threadId: string) {
        return sql<{
          permission_mode: PermissionMode | null
        }>`SELECT permission_mode FROM threads WHERE id = ${threadId}`.pipe(
          Effect.map((rows) => rows[0]?.permission_mode ?? undefined),
          Effect.mapError(storeError)
        )
      },
      setPermissionMode(threadId: string, mode?: PermissionMode) {
        return sql`UPDATE threads SET permission_mode = ${mode ?? null} WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      lineageDepth(threadId: string) {
        return sql<{
          lineage_depth: number
        }>`SELECT lineage_depth FROM threads WHERE id = ${threadId}`.pipe(
          Effect.map((rows) => rows[0]?.lineage_depth ?? 0),
          Effect.mapError(storeError)
        )
      },
      markAgentThread(threadId: string, parentThreadId: string, notify: boolean) {
        return sql`UPDATE threads SET lineage_depth = (SELECT lineage_depth + 1 FROM threads WHERE id = ${parentThreadId}), parent_thread_id = ${parentThreadId}, bot_id = (SELECT bot_id FROM threads WHERE id = ${parentThreadId}), created_by = 'agent', notify_parent = ${notify ? 1 : 0} WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      countCreation(turnId: string) {
        return sql`UPDATE orchestration_turns SET created_count = created_count + 1 WHERE turn_id = ${turnId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      getRequest(callerId: string, requestId: string, operation: string) {
        return sql<{
          result_json: string
        }>`SELECT result_json FROM orchestration_requests WHERE caller_id = ${callerId} AND request_id = ${requestId} AND operation = ${operation}`.pipe(
          Effect.map((rows) =>
            rows[0]
              ? (JSON.parse(rows[0].result_json) as { threadId: string; messageId?: string })
              : null
          ),
          Effect.mapError(storeError)
        )
      },
      saveRequest(
        callerId: string,
        requestId: string,
        operation: string,
        result: { threadId: string; messageId?: string }
      ) {
        return sql`INSERT INTO orchestration_requests VALUES (${callerId}, ${requestId}, ${operation}, ${JSON.stringify(result)})`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      createProject(path: string) {
        return createProjectResult(path).pipe(Effect.map(({ project }) => project))
      },
      createProjectResult,
      listProjects() {
        return sql<ProjectRow>`SELECT * FROM projects WHERE bot_id IS NULL ORDER BY created_at`.pipe(
          Effect.map((rows) => rows.map(rowToProject)),
          Effect.mapError(storeError)
        )
      },
      deleteProject(id: string) {
        return sql`DELETE FROM projects WHERE id = ${id}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      renameProject(id: string, title: string) {
        const trimmed = title.trim()
        if (trimmed.length === 0)
          return Effect.fail(new StoreError('invalid_params', 'Name is empty'))
        return Effect.gen(function* () {
          const rows =
            yield* sql<ProjectRow>`UPDATE projects SET title = ${trimmed} WHERE id = ${id} RETURNING *`
          if (!rows[0])
            return yield* Effect.fail(new StoreError('not_found', `Project ${id} not found`))
          return rowToProject(rows[0])
        }).pipe(Effect.mapError(storeError))
      },
      setProjectIcon(id: string, icon: ProjectIcon | null) {
        return Effect.gen(function* () {
          const rows =
            yield* sql<ProjectRow>`UPDATE projects SET icon = ${icon && JSON.stringify(icon)} WHERE id = ${id} RETURNING *`
          if (!rows[0])
            return yield* Effect.fail(new StoreError('not_found', `Project ${id} not found`))
          return rowToProject(rows[0])
        }).pipe(Effect.mapError(storeError))
      },
      getProject(id: string) {
        return sql<ProjectRow>`SELECT * FROM projects WHERE id = ${id}`.pipe(
          Effect.map((rows) => (rows[0] ? rowToProject(rows[0]) : null)),
          Effect.mapError(storeError)
        )
      },
      createThread(projectId: string, id: string) {
        return Effect.gen(function* () {
          const projects = yield* sql`SELECT id FROM projects WHERE id = ${projectId}`
          if (!projects.length)
            return yield* Effect.fail(new StoreError('not_found', `Project ${projectId} not found`))
          const existing = yield* getThread(id)
          if (existing) {
            if (existing.projectId !== projectId)
              return yield* Effect.fail(
                new StoreError(
                  'invalid_params',
                  `Thread ${id} already belongs to a different project`
                )
              )
            return existing
          }
          // A first send retried after its reply was lost mustn't bring back a thread deleted since.
          const deleted = yield* sql`SELECT id FROM deleted_threads WHERE id = ${id}`
          if (deleted.length)
            return yield* Effect.fail(new StoreError('not_found', 'This thread was deleted'))
          const aliases = yield* sql`SELECT id FROM threads WHERE lower(id) = lower(${id}) LIMIT 1`
          if (aliases.length)
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                'A thread with this id in a different case already exists'
              )
            )
          const thread: ThreadMeta = {
            id,
            projectId,
            environment: 'local',
            title: DEFAULT_THREAD_TITLE,
            status: 'idle',
            archived: false,
            pinned: false,
            updatedAt: Date.now(),
          }
          yield* sql`INSERT INTO threads (id, project_id, title, status, archived, pinned, title_locked, updated_at)
            VALUES (${id}, ${projectId}, ${thread.title}, ${thread.status}, 0, 0, 0, ${thread.updatedAt})`
          yield* writeState(id, { ...emptyThread, items: [] })
          return yield* requireThread(id)
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      archiveThread(threadId: string, archived: boolean) {
        return Effect.gen(function* () {
          const existing = yield* requireThread(threadId)
          yield* sql`UPDATE threads SET archived = ${archived ? 1 : 0}, archive_group = CASE WHEN ${archived ? 1 : 0} = 0 THEN NULL ELSE archive_group END WHERE id = ${threadId}`
          return { ...existing, archived }
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      renameThread(threadId: string, title: string) {
        const trimmed = title.trim()
        if (trimmed.length === 0)
          return Effect.fail(new StoreError('invalid_params', 'Title is empty'))
        return lockTitle(threadId, trimmed)
      },
      pinThread(threadId: string, pinned: boolean) {
        return Effect.gen(function* () {
          const existing = yield* requireThread(threadId)
          yield* sql`UPDATE threads SET pinned = ${pinned ? 1 : 0} WHERE id = ${threadId}`
          return { ...existing, pinned }
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      deleteThread(threadId: string) {
        return Effect.gen(function* () {
          const thread = yield* requireThread(threadId)
          const refs = yield* sql<{
            attachment_id: string
          }>`SELECT attachment_id FROM attachment_refs WHERE thread_id = ${threadId}`
          yield* sql`DELETE FROM attachment_refs WHERE thread_id = ${threadId}`
          yield* sql`DELETE FROM orchestration_turns WHERE thread_id = ${threadId}`
          yield* sql`DELETE FROM orchestration_requests WHERE caller_id = ${threadId}`
          yield* sql`DELETE FROM provider_sessions WHERE thread_id = ${threadId}`
          yield* sql`DELETE FROM thread_pull_requests WHERE thread_id = ${threadId}`
          yield* sql`DELETE FROM pull_requests WHERE NOT EXISTS (
            SELECT 1 FROM thread_pull_requests l WHERE l.repo = pull_requests.repo AND l.number = pull_requests.number
          )`
          yield* sql`DELETE FROM thread_events WHERE thread_id = ${threadId}`
          yield* sql`DELETE FROM thread_states WHERE thread_id = ${threadId}`
          yield* sql`INSERT OR IGNORE INTO deleted_threads (id) VALUES (${threadId})`
          yield* sql`DELETE FROM threads WHERE id = ${threadId}`
          loaded.delete(threadId)
          const queued = (thread.pendingMessages ?? []).flatMap((m) => m.attachments ?? [])
          return yield* unheld([
            ...queued.map((attachment) => attachment.id),
            ...refs.map((ref) => ref.attachment_id),
          ])
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      // Re-posting an attachment holds it for the thread it goes to before that thread's message
      // commits, so deleting the thread it came from meanwhile can't remove the file under it.
      reserveAttachment(threadId: string, id: string, kind: 'image' | 'video') {
        return Effect.gen(function* () {
          const [row] = yield* sql<{
            metadata_json: string
          }>`SELECT r.metadata_json FROM attachment_refs r
            JOIN threads t ON t.id = r.thread_id
            JOIN threads target ON target.id = ${threadId} AND target.project_id = t.project_id
            WHERE r.attachment_id = ${id} AND t.archived = 0 LIMIT 1`
          if (row) {
            const attachment = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Attachment))(
              row.metadata_json
            )
            if (attachment.mimeType.startsWith(kind + '/')) {
              yield* sql`INSERT OR IGNORE INTO attachment_refs (thread_id, attachment_id, metadata_json)
                VALUES (${threadId}, ${id}, ${row.metadata_json})`
              return attachment
            }
          }
          return yield* Effect.fail(
            new StoreError('not_found', `No ${kind} attachment ${id} in this project`)
          )
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      heldAttachments() {
        return heldAttachments().pipe(Effect.mapError(storeError))
      },
      unheldAttachments(ids: readonly string[]) {
        return unheld(ids).pipe(Effect.mapError(storeError))
      },
      getThread,
      requireThread,
      notifiesParent(threadId: string) {
        return notifiesParent(threadId).pipe(Effect.mapError(storeError))
      },
      listThreads(includeBots = false) {
        return Effect.gen(function* () {
          const rows = includeBots
            ? yield* sql<ThreadRow>`SELECT * FROM threads ORDER BY updated_at DESC`
            : yield* sql<ThreadRow>`SELECT * FROM threads WHERE id NOT IN (SELECT id FROM bots) ORDER BY updated_at DESC`
          const links = yield* sql<LinkRow>`${linkRows} ORDER BY l.linked_at DESC`
          const byThread = new Map<string, PullRequestLink[]>()
          for (const link of links) {
            const list = byThread.get(link.thread_id) ?? []
            list.push(rowToLink(link))
            byThread.set(link.thread_id, list)
          }
          return rows.map((row) => ({
            ...rowToThread(row),
            pullRequests: byThread.get(row.id) ?? [],
          }))
        }).pipe(Effect.mapError(storeError))
      },
      // `claim` links only while no thread has this pull request. `transfer` makes this the
      // only thread that does. A pull request already linked to several threads stays that way
      // until something transfers it.
      linkPullRequest(
        threadId: string,
        repo: string,
        number: number,
        mode: 'transfer' | 'claim' = 'transfer'
      ) {
        return Effect.gen(function* () {
          const current = yield* requireThread(threadId)
          const existing = yield* sql<{
            thread_id: string
          }>`SELECT thread_id FROM thread_pull_requests WHERE repo = ${repo} AND number = ${number}`
          const had = existing.some((row) => row.thread_id === threadId)
          if (mode === 'claim' && existing.length > 0)
            return { thread: current, changed: [], linked: had }
          yield* sql`INSERT OR IGNORE INTO pull_requests (repo, number) VALUES (${repo}, ${number})`
          const others = existing.filter((row) => row.thread_id !== threadId)
          if (others.length)
            yield* sql`DELETE FROM thread_pull_requests
              WHERE repo = ${repo} AND number = ${number} AND thread_id != ${threadId}`
          if (!had)
            yield* sql`INSERT OR IGNORE INTO thread_pull_requests (thread_id, repo, number, linked_at)
              VALUES (${threadId}, ${repo}, ${number}, ${Date.now()})`
          const changed: ThreadMeta[] = []
          if (!had) changed.push(yield* requireThread(threadId))
          for (const row of others) {
            const thread = yield* getThread(row.thread_id)
            if (thread) changed.push(thread)
          }
          return { thread: yield* requireThread(threadId), changed, linked: true as const }
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      unlinkPullRequest(threadId: string, repo: string, number: number) {
        return Effect.gen(function* () {
          yield* requireThread(threadId)
          yield* sql`DELETE FROM thread_pull_requests WHERE thread_id = ${threadId} AND repo = ${repo} AND number = ${number}`
          return yield* requireThread(threadId)
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      getPullRequest(repo: string, number: number) {
        return sql<{
          data_json: string | null
          status: PullRequestSnapshot['status']
          error: string | null
          refreshed_at: number | null
          data_refreshed_at: number | null
        }>`SELECT data_json, status, error, refreshed_at, data_refreshed_at FROM pull_requests WHERE repo = ${repo} AND number = ${number}`.pipe(
          Effect.map((rows): PullRequestSnapshot => {
            const row = rows[0]
            return {
              repo,
              number,
              status: row?.status ?? 'loading',
              ...(row?.data_json ? { data: JSON.parse(row.data_json) } : {}),
              ...(row?.error ? { error: row.error } : {}),
              ...(row?.refreshed_at ? { refreshedAt: row.refreshed_at } : {}),
              ...(row?.data_refreshed_at ? { dataRefreshedAt: row.data_refreshed_at } : {}),
            }
          }),
          Effect.mapError(storeError)
        )
      },
      savePullRequest(snapshot: PullRequestSnapshot) {
        return Effect.gen(function* () {
          yield* sql`INSERT INTO pull_requests (repo, number, data_json, status, error, refreshed_at, data_refreshed_at)
            VALUES (${snapshot.repo}, ${snapshot.number}, ${snapshot.data ? JSON.stringify(snapshot.data) : null}, ${snapshot.status}, ${snapshot.error ?? null}, ${snapshot.refreshedAt ?? null}, ${snapshot.dataRefreshedAt ?? null})
            ON CONFLICT(repo, number) DO UPDATE SET data_json = COALESCE(excluded.data_json, pull_requests.data_json),
              status = excluded.status, error = excluded.error, refreshed_at = excluded.refreshed_at,
              data_refreshed_at = COALESCE(excluded.data_refreshed_at, pull_requests.data_refreshed_at)`
          return snapshot
        }).pipe(Effect.mapError(storeError))
      },
      getPullRequestGuides(repo: string, number: number) {
        return sql<{
          head_sha: string
          status: PullRequestGuideState['status']
          guide_json: string | null
          model: string | null
          metrics_json: string | null
          error: string | null
          created_at: number
          updated_at: number
        }>`SELECT * FROM pull_request_guides WHERE repo = ${repo} AND number = ${number}
          ORDER BY updated_at DESC`.pipe(
          Effect.map((rows): StoredPullRequestGuide[] =>
            rows.map((row) => ({
              headSha: row.head_sha,
              status: row.status,
              ...(row.guide_json ? { guide: JSON.parse(row.guide_json) } : {}),
              ...(row.model ? { model: row.model } : {}),
              ...(row.metrics_json ? { metrics: JSON.parse(row.metrics_json) } : {}),
              ...(row.error ? { error: row.error } : {}),
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }))
          ),
          Effect.mapError(storeError)
        )
      },
      savePullRequestGuide(repo: string, number: number, guide: StoredPullRequestGuide) {
        return sql`INSERT INTO pull_request_guides
          (repo, number, head_sha, status, guide_json, model, metrics_json, error, created_at, updated_at)
          VALUES (${repo}, ${number}, ${guide.headSha}, ${guide.status}, ${guide.guide ? JSON.stringify(guide.guide) : null},
            ${guide.model ?? null}, ${guide.metrics ? JSON.stringify(guide.metrics) : null}, ${guide.error ?? null}, ${guide.createdAt}, ${guide.updatedAt})
          ON CONFLICT(repo, number, head_sha) DO UPDATE SET status = excluded.status,
            guide_json = excluded.guide_json, model = excluded.model, metrics_json = excluded.metrics_json,
            error = excluded.error, updated_at = excluded.updated_at`.pipe(
          Effect.mapError(storeError)
        )
      },
      getPullRequestList(tab: PullRequestListTab) {
        return sql<{
          items_json: string | null
          status: PullRequestList['status']
          error: string | null
          refreshed_at: number | null
          truncated: number
        }>`SELECT items_json, status, error, refreshed_at, truncated FROM pull_request_lists WHERE tab = ${tab}`.pipe(
          Effect.map((rows): PullRequestList => {
            const row = rows[0]
            return {
              tab,
              status: row?.status ?? 'loading',
              ...(row?.items_json ? { items: JSON.parse(row.items_json) } : {}),
              ...(row?.truncated ? { truncated: true } : {}),
              ...(row?.error ? { error: row.error } : {}),
              ...(row?.refreshed_at ? { refreshedAt: row.refreshed_at } : {}),
            }
          }),
          Effect.mapError(storeError)
        )
      },
      savePullRequestList(list: PullRequestList) {
        return sql`INSERT INTO pull_request_lists (tab, items_json, truncated, status, error, refreshed_at)
          VALUES (${list.tab}, ${list.items ? JSON.stringify(list.items) : null}, ${list.truncated ? 1 : 0}, ${list.status}, ${list.error ?? null}, ${list.refreshedAt ?? null})
          ON CONFLICT(tab) DO UPDATE SET items_json = COALESCE(excluded.items_json, pull_request_lists.items_json),
            truncated = CASE WHEN excluded.items_json IS NULL THEN pull_request_lists.truncated ELSE excluded.truncated END,
            status = excluded.status, error = excluded.error, refreshed_at = excluded.refreshed_at`.pipe(
          Effect.as(list),
          Effect.mapError(storeError)
        )
      },
      threadsForPullRequest(repo: string, number: number) {
        return sql<{
          thread_id: string
        }>`SELECT thread_id FROM thread_pull_requests WHERE repo = ${repo} AND number = ${number}
          ORDER BY linked_at`.pipe(
          Effect.map((rows) => rows.map((row) => row.thread_id)),
          Effect.mapError(storeError)
        )
      },
      // Open pull requests Jetty already has cached in `repo` whose head branch is `branch`.
      // A fork's head only counts when it is this repo. No GitHub call.
      openPullRequestsOnBranch(repo: string, branch: string) {
        return sql<{
          repo: string
          number: number
        }>`SELECT repo, number FROM pull_requests
          WHERE repo = ${repo}
            AND json_extract(data_json, '$.pull.head.ref') = ${branch}
            AND json_extract(data_json, '$.pull.state') = 'open'
            AND json_extract(data_json, '$.pull.merged') IS NOT 1
            AND (
              json_extract(data_json, '$.pull.head.repo') IS NULL
              OR lower(json_extract(data_json, '$.pull.head.repo')) = ${repo}
            )`.pipe(Effect.mapError(storeError))
      },
      pullRequestWatch(repo: string, number: number) {
        return sql<{
          watch_json: string | null
        }>`SELECT watch_json FROM pull_requests WHERE repo = ${repo} AND number = ${number}`.pipe(
          Effect.map(
            ([row]): PullRequestWatchMemory =>
              row?.watch_json ? JSON.parse(row.watch_json) : { fired: [] }
          ),
          Effect.mapError(storeError)
        )
      },
      savePullRequestWatch(repo: string, number: number, memory: PullRequestWatchMemory) {
        return sql`UPDATE pull_requests SET watch_json = ${JSON.stringify(memory)}
          WHERE repo = ${repo} AND number = ${number}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      pendingPullRequestWatches() {
        return sql<{
          repo: string
          number: number
          watch_json: string
        }>`SELECT repo, number, watch_json FROM pull_requests
          WHERE json_extract(watch_json, '$.pending') IS NOT NULL`.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              repo: row.repo,
              number: row.number,
              memory: JSON.parse(row.watch_json) as PullRequestWatchMemory,
            }))
          ),
          Effect.mapError(storeError)
        )
      },
      activePullRequestLinks(after?: { repo: string; number: number }) {
        return sql<{
          repo: string
          number: number
        }>`SELECT DISTINCT l.repo, l.number
          FROM thread_pull_requests l
          JOIN pull_requests p ON p.repo = l.repo AND p.number = l.number
          JOIN threads t ON t.id = l.thread_id
          WHERE t.archived = 0 AND json_extract(p.data_json, '$.pull.merged') IS NOT 1
            AND (${after?.repo ?? null} IS NULL OR l.repo > ${after?.repo ?? null}
              OR (l.repo = ${after?.repo ?? null} AND l.number > ${after?.number ?? null}))
          ORDER BY l.repo, l.number LIMIT 100`.pipe(Effect.mapError(storeError))
      },
      getThreadProvider(threadId: string) {
        return sql<{
          provider: string | null
        }>`SELECT provider FROM threads WHERE id = ${threadId}`.pipe(
          Effect.map((rows) => rows[0]?.provider ?? null),
          Effect.mapError(storeError)
        )
      },
      listProviderSessionProviders(threadId: string) {
        return sql<{
          provider: string
        }>`SELECT provider FROM provider_sessions WHERE thread_id = ${threadId}`.pipe(
          Effect.map((rows) => rows.map((row) => row.provider)),
          Effect.mapError(storeError)
        )
      },
      setThreadProviderIfAbsent(threadId: string, provider: string) {
        return Effect.gen(function* () {
          yield* sql`UPDATE threads SET provider = ${provider} WHERE id = ${threadId} AND provider IS NULL`
          const rows = yield* sql<{
            provider: string | null
          }>`SELECT provider FROM threads WHERE id = ${threadId}`
          const stored = rows[0]?.provider
          if (!stored)
            return yield* Effect.fail(new StoreError('not_found', `Thread ${threadId} not found`))
          return stored
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      setThreadLoadout(threadId: string, loadout: ThreadLoadout) {
        const fast = loadout.fast === undefined ? null : loadout.fast ? 1 : 0
        return Effect.gen(function* () {
          yield* sql`UPDATE threads SET model = ${loadout.model ?? null},
            effort = ${loadout.effort ?? null}, fast = ${fast} WHERE id = ${threadId}`
          return yield* requireThread(threadId)
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      getProviderSessionId(threadId: string, provider: string) {
        return sql<{ session_id: string }>`SELECT session_id FROM provider_sessions
          WHERE thread_id = ${threadId} AND provider = ${provider}`.pipe(
          Effect.map((rows) => rows[0]?.session_id ?? null),
          Effect.mapError(storeError)
        )
      },
      setProviderSessionId(threadId: string, provider: string, sessionId: string) {
        return sql`INSERT INTO provider_sessions (thread_id, provider, session_id)
          VALUES (${threadId}, ${provider}, ${sessionId})
          ON CONFLICT(thread_id, provider) DO UPDATE SET session_id = excluded.session_id`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      getThreadSessionId(threadId: string) {
        return sql<{
          agent_session_id: string | null
        }>`SELECT agent_session_id FROM threads WHERE id = ${threadId}`.pipe(
          Effect.map((rows) => rows[0]?.agent_session_id ?? null),
          Effect.mapError(storeError)
        )
      },
      setThreadSessionId(threadId: string, sessionId: string) {
        return sql`UPDATE threads SET agent_session_id = ${sessionId} WHERE id = ${threadId}`.pipe(
          Effect.asVoid,
          Effect.mapError(storeError)
        )
      },
      setThreadTitle: lockTitle,
      needsGeneratedTitle(threadId: string) {
        return sql<{ id: string }>`SELECT id FROM threads
          WHERE id = ${threadId} AND title_locked = 0 AND title = ${DEFAULT_THREAD_TITLE}`.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(storeError)
        )
      },
      setGeneratedTitle(threadId: string, title: string) {
        return Effect.gen(function* () {
          const existing = yield* requireThread(threadId)
          const now = Date.now()
          yield* sql`UPDATE threads SET title = ${title}, updated_at = ${now}
            WHERE id = ${threadId} AND title_locked = 0 AND title = ${DEFAULT_THREAD_TITLE}`
          const wrote = yield* sql<{ id: string }>`SELECT id FROM threads
            WHERE id = ${threadId} AND title = ${title} AND title_locked = 0 AND updated_at = ${now}`
          return wrote[0] ? { ...existing, title, updatedAt: now } : null
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      getThreadState,
      getBotConversation,
      markThreadSeen(threadId: string) {
        return Effect.gen(function* () {
          yield* requireThread(threadId)
          yield* sql`UPDATE threads SET ready_for_review = 0 WHERE id = ${threadId}`
          return yield* requireThread(threadId)
        }).pipe(Effect.mapError(storeError))
      },
      markReadyForReview(threadId: string) {
        return Effect.gen(function* () {
          yield* requireThread(threadId)
          yield* sql`UPDATE threads SET ready_for_review = 1 WHERE id = ${threadId}`
          return yield* requireThread(threadId)
        }).pipe(Effect.mapError(storeError))
      },
      appendEvent(threadId: string, event: ThreadEvent) {
        return append(threadId, event).pipe(
          atomically,
          Effect.tap(() =>
            event.type === 'turn.completed' || event.type === 'turn.failed'
              ? signalQueueChange.pipe(Effect.andThen(Queue.offer(persistWake, undefined)))
              : Effect.void
          ),
          Effect.mapError(storeError)
        )
      },
      appendEvents(threadId: string, events: readonly [ThreadEvent, ...ThreadEvent[]]) {
        return Effect.forEach(events, (event) => append(threadId, event)).pipe(
          atomically,
          Effect.tap(() => signalQueueChange),
          Effect.mapError(storeError)
        )
      },
      getEventsAfter(threadId: string, afterSeq: number) {
        return eventsAfter(threadId, afterSeq).pipe(Effect.mapError(storeError))
      },
    }
  })
}

export const storeLayer = Layer.effect(Store, createStore())
