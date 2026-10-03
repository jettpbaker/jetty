import { ThreadEvent, type SessionStatus } from '@jetty/shared/events'
import { Attachment } from '@jetty/shared/items'
import { applyEvent, emptyThread, ThreadState } from '@jetty/shared/reducer'
import {
  agentBehaviours,
  type AgentBehaviourKey,
  type AgentBehaviours,
  EffortLevel,
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
} from '@jetty/shared/wire'
import { Context, Effect, FileSystem, Layer, Path, Queue, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { normalizePath } from './fs-browse'

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
}

export type WorktreeRecord = {
  checkoutPath: string | null
  baseCommit: string
  branch: string | null
  temporaryBranch: string | null
  slot: number | null
  state: 'pending' | 'setting_up' | 'ready' | 'failed'
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
    pullRequests: [],
    updatedAt: row.updated_at,
    ...(row.turn_started_at === null ? {} : { turnStartedAt: row.turn_started_at }),
    ...(row.turn_ended_at === null ? {} : { turnEndedAt: row.turn_ended_at }),
    createdBy: row.created_by,
    ...(row.parent_thread_id ? { parentThreadId: row.parent_thread_id } : {}),
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
    }

    function rowToLink(row: LinkRow): PullRequestLink {
      return {
        repo: row.repo,
        number: row.number,
        url: `https://github.com/${row.repo}/pull/${row.number}`,
        linkedAt: row.linked_at,
        ...(row.title
          ? {
              title: row.title,
              state: row.merged
                ? ('merged' as const)
                : row.state === 'closed'
                  ? ('closed' as const)
                  : row.draft
                    ? ('draft' as const)
                    : ('open' as const),
              updatedAt: Date.parse(row.updated_at ?? ''),
            }
          : {}),
      }
    }

    function getLinks(threadId: string) {
      return sql<LinkRow>`SELECT l.*, json_extract(p.data_json, '$.pull.title') AS title,
        json_extract(p.data_json, '$.pull.state') AS state,
        json_extract(p.data_json, '$.pull.merged') AS merged,
        json_extract(p.data_json, '$.pull.draft') AS draft,
        json_extract(p.data_json, '$.pull.updated_at') AS updated_at FROM thread_pull_requests l
        JOIN pull_requests p ON p.repo = l.repo AND p.number = l.number
        WHERE l.thread_id = ${threadId} ORDER BY l.linked_at DESC`.pipe(
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
    function atomically<A, E, R>(effect: Effect.Effect<A, E, R>) {
      return Effect.suspend(() => {
        const before = new Map(Array.from(loaded, ([id, entry]) => [id, entry.state]))
        return effect.pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              for (const [id, entry] of loaded)
                if (before.get(id) !== entry.state) loaded.delete(id)
            })
          )
        )
      }).pipe(sql.withTransaction)
    }

    function getThreadState(threadId: string) {
      return loadThread(threadId).pipe(
        Effect.map((entry) => entry.state),
        sql.withTransaction,
        Effect.mapError(storeError)
      )
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
            const { state } = entry
            yield* writeState(threadId, state)
            entry.persistedSeq = state.lastSeq
          }).pipe(
            sql.withTransaction,
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

    function enqueue(threadId: string, message: QueuedMessage) {
      return Effect.gen(function* () {
        const thread = yield* requireThread(threadId)
        if (thread.archived)
          return yield* Effect.fail(new StoreError('not_found', 'Thread is archived'))
        if (message.hop > 20)
          return yield* Effect.fail(new StoreError('invalid_params', 'Message hop limit exceeded'))
        yield* updateQueue(threadId, [...(thread.pendingMessages ?? []), message])
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

    function notifiesParent(threadId: string) {
      return sql<{
        notify_parent: number
      }>`SELECT notify_parent FROM threads WHERE id = ${threadId}`.pipe(
        Effect.map(([row]) => row?.notify_parent === 1)
      )
    }

    function append(threadId: string, event: ThreadEvent, notifyParent = true) {
      return Effect.gen(function* () {
        const [threadRow] = yield* sql<ThreadRow>`SELECT * FROM threads WHERE id = ${threadId}`
        if (!threadRow)
          return yield* Effect.fail(new StoreError('not_found', `Thread ${threadId} not found`))
        const thread = rowToThread(threadRow)
        const validated = yield* Schema.decodeUnknownEffect(ThreadEvent)(event)
        const entry = yield* loadThread(threadId)
        const prev = entry.state
        const seq = prev.lastSeq + 1
        const ts = Date.now()
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(ThreadEvent))(validated)
        yield* sql`INSERT INTO thread_events (thread_id, seq, ts, payload_json) VALUES (${threadId}, ${seq}, ${ts}, ${json})`
        const state = yield* Effect.try({
          try: () => applyEvent(prev, { seq, ts, event: validated }),
          catch: storeError,
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
        if (notifyParent && event.type === 'turn.failed' && !prev.turnOutcomes[event.turnId]) {
          yield* Effect.gen(function* () {
            const parent = thread.parentThreadId ? yield* getThread(thread.parentThreadId) : null
            const [turn] = yield* sql<{
              hop: number
              initiator_thread_id: string | null
            }>`SELECT hop, initiator_thread_id FROM orchestration_turns WHERE turn_id = ${event.turnId}`
            const hop = (turn?.hop ?? 0) + 1
            if (
              !(yield* notifiesParent(threadId)) ||
              !parent ||
              parent.archived ||
              turn?.initiator_thread_id !== parent.id
            )
              return
            if (hop > 20)
              return yield* Effect.logWarning(
                `Failure notification from ${threadId} dropped: message hop limit exceeded`
              )
            yield* enqueue(parent.id, {
              id: newId(),
              createdAt: ts,
              hop,
              from: { threadId, title: thread.title },
              text: `Thread ${thread.title} failed: ${event.error}`,
            })
          }).pipe(Effect.catchCause((cause) => Effect.logWarning(cause)))
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
          return yield* Effect.fail(new StoreError('conflict', 'Caller has no active turn'))
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

    return {
      queueChanges,
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
      enqueue(threadId: string, message: QueuedMessage) {
        return enqueue(threadId, message).pipe(
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
      beginDelivery(threadId: string, turnId: string, hop: number, messageId?: string) {
        return Effect.gen(function* () {
          const entry = yield* loadThread(threadId)
          if (!entry.state.activeTurnId) {
            // The only state change without an event, so it is persisted right away.
            const state = { ...entry.state, activeTurnId: turnId, status: 'starting' as const }
            yield* writeState(threadId, state)
            entry.state = state
            entry.persistedSeq = state.lastSeq
            yield* sql`UPDATE threads SET status = 'starting', ready_for_review = 0 WHERE id = ${threadId}`
          }
          const thread = yield* requireThread(threadId)
          const initiator =
            thread.pendingMessages?.find((m) => m.id === messageId)?.from?.threadId ?? null
          yield* sql`INSERT INTO orchestration_turns (turn_id, thread_id, hop, initiator_thread_id) VALUES (${turnId}, ${threadId}, ${hop}, ${initiator}) ON CONFLICT(turn_id) DO UPDATE SET hop = MAX(hop, excluded.hop)`
          if (messageId) yield* removeQueued(threadId, messageId)
        }).pipe(atomically, Effect.mapError(storeError))
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
        return sql`UPDATE threads SET lineage_depth = (SELECT lineage_depth + 1 FROM threads WHERE id = ${parentThreadId}), parent_thread_id = ${parentThreadId}, created_by = 'agent', notify_parent = ${notify ? 1 : 0} WHERE id = ${threadId}`.pipe(
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
        return Effect.gen(function* () {
          const normalized = normalizePath(path)
          const isDir = yield* fs.stat(normalized).pipe(
            Effect.map((stat) => stat.type === 'Directory'),
            Effect.catch(() => Effect.succeed(false))
          )
          if (!isDir)
            return yield* Effect.fail(
              new StoreError('invalid_params', `Not an existing directory: ${path}`)
            )
          return yield* Effect.gen(function* () {
            const rows = yield* sql<ProjectRow>`SELECT * FROM projects WHERE path = ${normalized}`
            if (rows[0]) return rowToProject(rows[0])
            const project: Project = {
              id: newId(),
              path: normalized,
              title: paths.basename(normalized) || normalized,
              createdAt: Date.now(),
            }
            yield* sql`INSERT INTO projects (id, path, title, created_at) VALUES (${project.id}, ${project.path}, ${project.title}, ${project.createdAt})`
            return project
          }).pipe(sql.withTransaction)
        }).pipe(Effect.mapError(storeError))
      },
      listProjects() {
        return sql<ProjectRow>`SELECT * FROM projects ORDER BY created_at`.pipe(
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
          yield* sql`UPDATE threads SET archived = ${archived ? 1 : 0} WHERE id = ${threadId}`
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
          yield* sql`DELETE FROM threads WHERE id = ${threadId}`
          loaded.delete(threadId)
          const queued = (thread.pendingMessages ?? []).flatMap((m) => m.attachments ?? [])
          const unused = queued.map((attachment) => attachment.id)
          for (const { attachment_id: id } of refs) {
            const shared =
              yield* sql`SELECT 1 FROM attachment_refs WHERE attachment_id = ${id} LIMIT 1`
            if (!shared.length) unused.push(id)
          }
          return unused
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      resolveAttachment(projectId: string, id: string, kind: 'image' | 'video') {
        return Effect.gen(function* () {
          const [row] = yield* sql<{
            metadata_json: string
          }>`SELECT r.metadata_json FROM attachment_refs r
            JOIN threads t ON t.id = r.thread_id
            WHERE r.attachment_id = ${id} AND t.project_id = ${projectId} AND t.archived = 0 LIMIT 1`
          if (row) {
            const attachment = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Attachment))(
              row.metadata_json
            )
            if (attachment.mimeType.startsWith(kind + '/')) return attachment
          }
          return yield* Effect.fail(
            new StoreError('not_found', 'Attachment not found in caller project')
          )
        }).pipe(Effect.mapError(storeError))
      },
      getThread,
      requireThread,
      notifiesParent(threadId: string) {
        return notifiesParent(threadId).pipe(Effect.mapError(storeError))
      },
      listThreads() {
        return Effect.gen(function* () {
          const rows = yield* sql<ThreadRow>`SELECT * FROM threads ORDER BY updated_at DESC`
          const links =
            yield* sql<LinkRow>`SELECT l.*, json_extract(p.data_json, '$.pull.title') AS title,
            json_extract(p.data_json, '$.pull.state') AS state,
            json_extract(p.data_json, '$.pull.merged') AS merged,
            json_extract(p.data_json, '$.pull.draft') AS draft,
            json_extract(p.data_json, '$.pull.updated_at') AS updated_at FROM thread_pull_requests l
            JOIN pull_requests p ON p.repo = l.repo AND p.number = l.number ORDER BY l.linked_at DESC`
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
      linkPullRequest(threadId: string, repo: string, number: number) {
        return Effect.gen(function* () {
          yield* requireThread(threadId)
          yield* sql`INSERT OR IGNORE INTO pull_requests (repo, number) VALUES (${repo}, ${number})`
          yield* sql`INSERT OR IGNORE INTO thread_pull_requests (thread_id, repo, number, linked_at)
            VALUES (${threadId}, ${repo}, ${number}, ${Date.now()})`
          return yield* requireThread(threadId)
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      hasPullRequestLink(threadId: string, repo: string, number: number) {
        return sql`SELECT 1 FROM thread_pull_requests WHERE thread_id = ${threadId} AND repo = ${repo} AND number = ${number} LIMIT 1`.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(storeError)
        )
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
        }>`SELECT data_json, status, error, refreshed_at FROM pull_requests WHERE repo = ${repo} AND number = ${number}`.pipe(
          Effect.map((rows): PullRequestSnapshot => {
            const row = rows[0]
            return {
              repo,
              number,
              status: row?.status ?? 'loading',
              ...(row?.data_json ? { data: JSON.parse(row.data_json) } : {}),
              ...(row?.error ? { error: row.error } : {}),
              ...(row?.refreshed_at ? { refreshedAt: row.refreshed_at } : {}),
            }
          }),
          Effect.mapError(storeError)
        )
      },
      savePullRequest(snapshot: PullRequestSnapshot) {
        return Effect.gen(function* () {
          yield* sql`INSERT INTO pull_requests (repo, number, data_json, status, error, refreshed_at)
            VALUES (${snapshot.repo}, ${snapshot.number}, ${snapshot.data ? JSON.stringify(snapshot.data) : null}, ${snapshot.status}, ${snapshot.error ?? null}, ${snapshot.refreshedAt ?? null})
            ON CONFLICT(repo, number) DO UPDATE SET data_json = COALESCE(excluded.data_json, pull_requests.data_json),
              status = excluded.status, error = excluded.error, refreshed_at = excluded.refreshed_at`
          return snapshot
        }).pipe(Effect.mapError(storeError))
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
        }>`SELECT thread_id FROM thread_pull_requests WHERE repo = ${repo} AND number = ${number}`.pipe(
          Effect.map((rows) => rows.map((row) => row.thread_id)),
          Effect.mapError(storeError)
        )
      },
      activePullRequestLinks() {
        return sql<{
          repo: string
          number: number
        }>`SELECT DISTINCT l.repo, l.number
          FROM thread_pull_requests l
          JOIN pull_requests p ON p.repo = l.repo AND p.number = l.number
          JOIN threads t ON t.id = l.thread_id
          WHERE t.archived = 0
          ORDER BY json_extract(p.data_json, '$.pull.state') IS 'closed'
          LIMIT 100`.pipe(Effect.mapError(storeError))
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
      appendEvent(threadId: string, event: ThreadEvent, notifyParent = true) {
        return append(threadId, event, notifyParent).pipe(
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
