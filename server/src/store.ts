import type { SessionStatus, ThreadEvent } from '@jetty/shared/events'
import type { Database } from 'bun:sqlite'

import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { newId, type ErrorCode, type Project, type ThreadMeta } from '@jetty/shared/wire'
import { basename } from 'node:path'

export type AppendedEvent = {
  seq: number
  ts: number
  event: ThreadEvent
  state: ThreadState
  prevStatus: SessionStatus
}

type ProjectRow = {
  id: string
  path: string
  title: string
  created_at: number
}

type ThreadRow = {
  id: string
  project_id: string
  title: string
  status: SessionStatus
  archived: number
  updated_at: number
}

export type Store = ReturnType<typeof createStore>

export function createStore(db: Database) {
  const insertProject = db.prepare(
    'INSERT INTO projects (id, path, title, created_at) VALUES (?, ?, ?, ?)'
  )
  const selectProjects = db.prepare(
    'SELECT id, path, title, created_at FROM projects ORDER BY created_at'
  )
  const selectProject = db.prepare('SELECT id, path, title, created_at FROM projects WHERE id = ?')

  const insertThread = db.prepare(
    `INSERT INTO threads (id, project_id, title, status, archived, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  )
  const selectThreads = db.prepare(
    `SELECT id, project_id, title, status, archived, updated_at
     FROM threads ORDER BY updated_at DESC`
  )
  const selectThread = db.prepare(
    `SELECT id, project_id, title, status, archived, updated_at
     FROM threads WHERE id = ?`
  )
  const selectThreadSessionId = db.prepare('SELECT agent_session_id FROM threads WHERE id = ?')
  const updateThreadSessionId = db.prepare('UPDATE threads SET agent_session_id = ? WHERE id = ?')
  const updateThreadArchive = db.prepare(
    'UPDATE threads SET archived = 1, updated_at = ? WHERE id = ?'
  )
  const updateThreadStatus = db.prepare(
    'UPDATE threads SET status = ?, updated_at = ? WHERE id = ?'
  )
  const touchThread = db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?')

  const insertEvent = db.prepare(
    'INSERT INTO thread_events (thread_id, seq, ts, payload_json) VALUES (?, ?, ?, ?)'
  )
  const selectEventsAfter = db.prepare(
    `SELECT seq, ts, payload_json FROM thread_events
     WHERE thread_id = ? AND seq > ?
     ORDER BY seq`
  )

  const upsertState = db.prepare(
    `INSERT INTO thread_states (thread_id, state_json, last_seq) VALUES (?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET state_json = excluded.state_json, last_seq = excluded.last_seq`
  )
  const selectState = db.prepare(
    'SELECT state_json, last_seq FROM thread_states WHERE thread_id = ?'
  )

  const appendTx = db.transaction((threadId: string, event: ThreadEvent): AppendedEvent => {
    const prev = getThreadState(threadId)
    const seq = prev.lastSeq + 1
    const ts = Date.now()
    insertEvent.run(threadId, seq, ts, JSON.stringify(event))
    const state = applyEvent(prev, { seq, ts, event })
    upsertState.run(threadId, JSON.stringify(state), state.lastSeq)
    touchThread.run(ts, threadId)
    if (state.status !== prev.status) {
      updateThreadStatus.run(state.status, ts, threadId)
    }
    return { seq, ts, event, state, prevStatus: prev.status }
  })

  function rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      path: row.path,
      title: row.title,
      createdAt: row.created_at,
    }
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

  function getThreadState(threadId: string): ThreadState {
    const row = selectState.get(threadId) as { state_json: string; last_seq: number } | null
    if (!row) return { ...emptyThread, items: [] }
    return JSON.parse(row.state_json) as ThreadState
  }

  return {
    createProject(path: string, title?: string): Project {
      const project: Project = {
        id: newId(),
        path,
        title: title ?? (basename(path) || path),
        createdAt: Date.now(),
      }
      insertProject.run(project.id, project.path, project.title, project.createdAt)
      return project
    },

    listProjects(): Project[] {
      return (selectProjects.all() as ProjectRow[]).map(rowToProject)
    },

    getProject(id: string): Project | null {
      const row = selectProject.get(id) as ProjectRow | null
      return row ? rowToProject(row) : null
    },

    createThread(projectId: string): ThreadMeta {
      if (!selectProject.get(projectId)) {
        throw new StoreError('not_found', `Project ${projectId} not found`)
      }
      const now = Date.now()
      const thread: ThreadMeta = {
        id: newId(),
        projectId,
        title: 'New thread',
        status: 'idle',
        archived: false,
        updatedAt: now,
      }
      insertThread.run(thread.id, thread.projectId, thread.title, thread.status, thread.updatedAt)
      upsertState.run(thread.id, JSON.stringify({ ...emptyThread, items: [] }), 0)
      return thread
    },

    archiveThread(threadId: string): ThreadMeta {
      const existing = selectThread.get(threadId) as ThreadRow | null
      if (!existing) throw new StoreError('not_found', `Thread ${threadId} not found`)
      const now = Date.now()
      updateThreadArchive.run(now, threadId)
      return rowToThread({ ...existing, archived: 1, updated_at: now })
    },

    getThread(threadId: string): ThreadMeta | null {
      const row = selectThread.get(threadId) as ThreadRow | null
      return row ? rowToThread(row) : null
    },

    listThreads(): ThreadMeta[] {
      return (selectThreads.all() as ThreadRow[]).map(rowToThread)
    },

    getThreadSessionId(threadId: string): string | null {
      const row = selectThreadSessionId.get(threadId) as {
        agent_session_id: string | null
      } | null
      return row?.agent_session_id ?? null
    },

    setThreadSessionId(threadId: string, sessionId: string): void {
      updateThreadSessionId.run(sessionId, threadId)
    },

    getThreadState,

    appendEvent(threadId: string, event: ThreadEvent): AppendedEvent {
      if (!selectThread.get(threadId)) {
        throw new StoreError('not_found', `Thread ${threadId} not found`)
      }
      return appendTx(threadId, event)
    },

    getEventsAfter(
      threadId: string,
      afterSeq: number
    ): Array<{ seq: number; ts: number; event: ThreadEvent }> {
      const rows = selectEventsAfter.all(threadId, afterSeq) as Array<{
        seq: number
        ts: number
        payload_json: string
      }>
      return rows.map((row) => ({
        seq: row.seq,
        ts: row.ts,
        event: JSON.parse(row.payload_json) as ThreadEvent,
      }))
    },
  }
}

export class StoreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'StoreError'
  }
}
