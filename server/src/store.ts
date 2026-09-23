import { ThreadEvent, type SessionStatus } from '@jetty/shared/events'
import { Attachment } from '@jetty/shared/items'
import { applyEvent, emptyThread, ThreadState } from '@jetty/shared/reducer'
import {
  EffortLevel,
  newId,
  type ErrorCode,
  type Project,
  type ProviderId,
  type ThreadMeta,
  type QueuedMessage,
  type PermissionMode,
} from '@jetty/shared/wire'
import { Context, Effect, FileSystem, Layer, Path, Queue, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { normalizePath } from './fs-browse'

const DEFAULT_THREAD_TITLE = 'New thread'

export type AppendedEvent = {
  seq: number
  ts: number
  event: ThreadEvent
  state: ThreadState
  prevStatus: SessionStatus
  thread: ThreadMeta
}

type ProjectRow = { id: string; path: string; title: string; created_at: number }
type ThreadRow = {
  id: string
  project_id: string
  title: string
  status: SessionStatus
  archived: number
  pinned: number
  updated_at: number
  provider: string | null
  model: string | null
  effort: string | null
  fast: number | null
  parent_thread_id: string | null
  created_by: 'user' | 'agent'
  pending_messages: string
}

export type ThreadLoadout = { model?: string; effort?: EffortLevel; fast?: boolean }

const isEffort = Schema.is(EffortLevel)

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
  return { id: row.id, path: row.path, title: row.title, createdAt: row.created_at }
}

function publicProvider(value: string | null): ProviderId | undefined {
  if (value === 'claude' || value === 'codex' || value === 'grok') return value
  return undefined
}

function rowToThread(row: ThreadRow): ThreadMeta {
  const provider = publicProvider(row.provider)
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    archived: row.archived !== 0,
    pinned: row.pinned !== 0,
    updatedAt: row.updated_at,
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
    const queueChanges = yield* Queue.sliding<void>(1)
    const signalQueueChange = Queue.offer(queueChanges, undefined)

    function getThread(threadId: string) {
      return sql<ThreadRow>`SELECT * FROM threads WHERE id = ${threadId}`.pipe(
        Effect.map((rows) => (rows[0] ? rowToThread(rows[0]) : null)),
        Effect.mapError(storeError)
      )
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

    function getThreadState(threadId: string) {
      return Effect.gen(function* () {
        const rows = yield* sql<{
          state_json: string
          last_seq: number
        }>`SELECT state_json, last_seq FROM thread_states WHERE thread_id = ${threadId}`
        const row = rows[0]
        if (!row) return { ...emptyThread, items: [] }
        const state = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadState))(
          row.state_json
        )
        if (state.lastSeq !== row.last_seq)
          return yield* Effect.fail(
            new StoreError('internal', `Invalid snapshot sequence for thread ${threadId}`)
          )
        return state
      }).pipe(Effect.mapError(storeError))
    }

    function writeState(threadId: string, state: ThreadState) {
      return Effect.gen(function* () {
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(ThreadState))(state)
        yield* sql`INSERT INTO thread_states (thread_id, state_json, last_seq)
          VALUES (${threadId}, ${json}, ${state.lastSeq})
          ON CONFLICT(thread_id) DO UPDATE SET state_json = excluded.state_json, last_seq = excluded.last_seq`
      })
    }

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

    function append(threadId: string, event: ThreadEvent, notifyParent = true) {
      return Effect.gen(function* () {
        const thread = yield* requireThread(threadId)
        const validated = yield* Schema.decodeUnknownEffect(ThreadEvent)(event)
        const prev = yield* getThreadState(threadId)
        const seq = prev.lastSeq + 1
        const ts = Date.now()
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(ThreadEvent))(validated)
        yield* sql`INSERT INTO thread_events (thread_id, seq, ts, payload_json) VALUES (${threadId}, ${seq}, ${ts}, ${json})`
        const state = yield* Effect.try({
          try: () => applyEvent(prev, { seq, ts, event: validated }),
          catch: storeError,
        })
        yield* writeState(threadId, state)
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
        if (
          notifyParent &&
          (event.type === 'turn.completed' || event.type === 'turn.failed') &&
          !prev.turnOutcomes[event.turnId]
        ) {
          yield* Effect.gen(function* () {
            const [settings] = yield* sql<{
              notify_parent: number
            }>`SELECT notify_parent FROM threads WHERE id = ${threadId}`
            const parent = thread.parentThreadId ? yield* getThread(thread.parentThreadId) : null
            const [turn] = yield* sql<{
              hop: number
              initiator_thread_id: string | null
            }>`SELECT hop, initiator_thread_id FROM orchestration_turns WHERE turn_id = ${event.turnId}`
            const hop = (turn?.hop ?? 0) + 1
            if (
              settings?.notify_parent &&
              parent &&
              !parent.archived &&
              turn?.initiator_thread_id === parent.id
            ) {
              const reply = state.items
                .filter((item) => item.turnId === event.turnId && item.kind === 'assistant_message')
                .map((item) => ('text' in item ? item.text : ''))
                .join('\n')
              if (hop > 20) {
                yield* Effect.logWarning(
                  `Completion notification from ${threadId} dropped: message hop limit exceeded`
                )
              } else {
                const media = state.items.flatMap((item) =>
                  item.turnId !== event.turnId
                    ? []
                    : item.kind === 'image_gallery'
                      ? item.images.map((image) => ({
                          kind: 'image',
                          ...image,
                          caption: item.caption,
                        }))
                      : item.kind === 'video'
                        ? [{ kind: 'video', ...item.video, caption: item.caption }]
                        : []
                )
                yield* enqueue(parent.id, {
                  id: newId(),
                  createdAt: ts,
                  hop,
                  from: { threadId, title: thread.title },
                  text: `Thread ${thread.title} ${event.type === 'turn.failed' ? 'failed' : 'is ready for review'}: ${(event.type === 'turn.failed' ? event.error : reply).slice(0, 2000)}${media.length ? '\nMedia available to re-post with send_images/send_video by attachment id:\n' + media.map((a) => JSON.stringify({ attachmentId: a.id, kind: a.kind, name: a.name, caption: a.caption })).join('\n') : ''}`,
                })
              }
            }
          }).pipe(Effect.catchCause((cause) => Effect.logWarning(cause)))
        }
        yield* sql`UPDATE threads SET status = ${state.status}, updated_at = ${ts} WHERE id = ${threadId}`
        return {
          seq,
          ts,
          event: validated,
          state,
          prevStatus: prev.status,
          thread: { ...thread, status: state.status, updatedAt: ts },
        } satisfies AppendedEvent
      })
    }

    function turnContext(threadId: string) {
      return Effect.gen(function* () {
        const state = yield* getThreadState(threadId)
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
      transaction<A, E, R>(effect: Effect.Effect<A, E, R>) {
        return effect.pipe(sql.withTransaction, Effect.mapError(storeError))
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
              (thread.pendingMessages ?? []).map((m) => (m.id === messageId ? { ...m, text } : m))
            )
          else yield* removeQueued(threadId, messageId)
          return yield* requireThread(threadId)
        }).pipe(
          sql.withTransaction,
          Effect.tap(() => signalQueueChange),
          Effect.mapError(storeError)
        )
      },
      beginDelivery(threadId: string, turnId: string, hop: number, messageId?: string) {
        return Effect.gen(function* () {
          const current = yield* getThreadState(threadId)
          if (!current.activeTurnId) {
            yield* writeState(threadId, { ...current, activeTurnId: turnId, status: 'starting' })
            yield* sql`UPDATE threads SET status = 'starting' WHERE id = ${threadId}`
          }
          const thread = yield* requireThread(threadId)
          const initiator =
            thread.pendingMessages?.find((m) => m.id === messageId)?.from?.threadId ?? null
          yield* sql`INSERT INTO orchestration_turns (turn_id, thread_id, hop, initiator_thread_id) VALUES (${turnId}, ${threadId}, ${hop}, ${initiator}) ON CONFLICT(turn_id) DO UPDATE SET hop = MAX(hop, excluded.hop)`
          if (messageId) yield* removeQueued(threadId, messageId)
        }).pipe(Effect.mapError(storeError))
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
      archiveThread(threadId: string) {
        return Effect.gen(function* () {
          const existing = yield* requireThread(threadId)
          const now = Date.now()
          yield* sql`UPDATE threads SET archived = 1, updated_at = ${now} WHERE id = ${threadId}`
          return { ...existing, archived: true, updatedAt: now }
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
          yield* sql`DELETE FROM thread_events WHERE thread_id = ${threadId}`
          yield* sql`DELETE FROM thread_states WHERE thread_id = ${threadId}`
          yield* sql`DELETE FROM threads WHERE id = ${threadId}`
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
      listThreads() {
        return sql<ThreadRow>`SELECT * FROM threads ORDER BY updated_at DESC`.pipe(
          Effect.map((rows) => rows.map(rowToThread)),
          Effect.mapError(storeError)
        )
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
      appendEvent(threadId: string, event: ThreadEvent, notifyParent = true) {
        return append(threadId, event, notifyParent).pipe(
          sql.withTransaction,
          Effect.tap(() =>
            event.type === 'turn.completed' || event.type === 'turn.failed'
              ? signalQueueChange
              : Effect.void
          ),
          Effect.mapError(storeError)
        )
      },
      appendEvents(threadId: string, events: readonly [ThreadEvent, ...ThreadEvent[]]) {
        return Effect.forEach(events, (event) => append(threadId, event)).pipe(
          sql.withTransaction,
          Effect.tap(() => signalQueueChange),
          Effect.mapError(storeError)
        )
      },
      getEventsAfter(threadId: string, afterSeq: number) {
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
        }).pipe(Effect.mapError(storeError))
      },
    }
  })
}

export const storeLayer = Layer.effect(Store, createStore())
