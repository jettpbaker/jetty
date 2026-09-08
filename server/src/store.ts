import { ThreadEvent, type SessionStatus } from '@jetty/shared/events'
import { applyEvent, emptyThread, ThreadState } from '@jetty/shared/reducer'
import { newId, type ErrorCode, type Project, type ThreadMeta } from '@jetty/shared/wire'
import { Context, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { statSync } from 'node:fs'
import { basename } from 'node:path'

import { normalizePath } from './fs-browse'

export const DEFAULT_THREAD_TITLE = 'New thread'

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
  updated_at: number
}

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

function rowToThread(row: ThreadRow): ThreadMeta {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    archived: row.archived !== 0,
    updatedAt: row.updated_at,
  }
}

export type Store = Effect.Success<ReturnType<typeof createStore>>
export const Store = Context.Service<Store>('jetty/Store')

export function createStore() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

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

    function append(threadId: string, event: ThreadEvent) {
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

    return {
      createProject(path: string) {
        return Effect.gen(function* () {
          const normalized = normalizePath(path)
          const isDir = yield* Effect.try(() => statSync(normalized).isDirectory()).pipe(
            Effect.catch(() => Effect.succeed(false))
          )
          if (!isDir)
            return yield* Effect.fail(
              new StoreError('invalid_params', `Not an existing directory: ${path}`)
            )
          const rows = yield* sql<ProjectRow>`SELECT * FROM projects WHERE path = ${normalized}`
          if (rows[0]) return rowToProject(rows[0])
          const project: Project = {
            id: newId(),
            path: normalized,
            title: basename(normalized) || normalized,
            createdAt: Date.now(),
          }
          yield* sql`INSERT INTO projects (id, path, title, created_at) VALUES (${project.id}, ${project.path}, ${project.title}, ${project.createdAt})`
          return project
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
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
            updatedAt: Date.now(),
          }
          yield* sql`INSERT INTO threads (id, project_id, title, status, archived, updated_at)
            VALUES (${id}, ${projectId}, ${thread.title}, ${thread.status}, 0, ${thread.updatedAt})`
          yield* writeState(id, { ...emptyThread, items: [] })
          return thread
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
      getThread,
      listThreads() {
        return sql<ThreadRow>`SELECT * FROM threads ORDER BY updated_at DESC`.pipe(
          Effect.map((rows) => rows.map(rowToThread)),
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
      setThreadTitle(threadId: string, title: string) {
        return Effect.gen(function* () {
          const existing = yield* requireThread(threadId)
          const now = Date.now()
          yield* sql`UPDATE threads SET title = ${title}, updated_at = ${now} WHERE id = ${threadId}`
          return { ...existing, title, updatedAt: now }
        }).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      getThreadState,
      appendEvent(threadId: string, event: ThreadEvent) {
        return append(threadId, event).pipe(sql.withTransaction, Effect.mapError(storeError))
      },
      appendEvents(threadId: string, events: readonly [ThreadEvent, ...ThreadEvent[]]) {
        return Effect.forEach(events, (event) => append(threadId, event)).pipe(
          sql.withTransaction,
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
