import type { ThreadEvent } from '@jetty/shared/events'
import type { Database } from 'bun:sqlite'

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  Append,
  BotRow,
  EventRow,
  Snapshot,
  ThreadRow,
  TranscriptEntry,
  TranscriptLine,
} from './wire'

type BotRecord = {
  id: string
  name: string
  color: string
  provider: string
  model: string
  effort: string | null
  created_at: number
  seen_at: number
}

type ThreadRecord = {
  id: string
  title: string
  parent_thread_id: string | null
  provider: string | null
  model: string | null
  session_id: string | null
  status: string
  archived: number
}

type EventRecord = { thread_id: string; seq: number; ts: number; payload_json: string }

function toBot(row: BotRecord): BotRow {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    createdAt: row.created_at,
    seenAt: row.seen_at,
  }
}

export function listBots(db: Database) {
  return db
    .query<BotRecord, []>(
      `SELECT id, name, color, provider, model, effort, created_at, seen_at FROM bots
       ORDER BY seen_at DESC`
    )
    .all()
    .map(toBot)
}

// Claude Code keeps a session's transcript under its cwd with every non-alphanumeric turned to '-'.
function transcriptDir(claudeHome: string, cwd: string) {
  return join(claudeHome, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
}

export function createBotSource(
  db: Database,
  botId: string,
  paths: { jettyHome: string; claudeHome: string }
) {
  const dir = transcriptDir(paths.claudeHome, join(paths.jettyHome, 'bots', botId))
  const lastSeq = new Map<string, number>()
  const seenThreads = new Map<string, string>()
  const tails = new Map<string, { offset: number; line: number }>()

  const threadQuery = db.query<ThreadRecord, [string]>(
    `WITH RECURSIVE tree(id) AS (
       SELECT id FROM threads WHERE id = ?1
       UNION SELECT t.id FROM threads t JOIN tree ON t.parent_thread_id = tree.id
     )
     SELECT t.id, t.title, t.parent_thread_id, t.provider, t.model, t.status, t.archived,
       COALESCE(t.agent_session_id, (SELECT session_id FROM provider_sessions p
         WHERE p.thread_id = t.id AND p.provider = t.provider)) AS session_id
     FROM threads t JOIN tree USING (id)`
  )
  const eventQuery = db.query<EventRecord, [string, number]>(
    `SELECT thread_id, seq, ts, payload_json FROM thread_events
     WHERE thread_id = ?1 AND seq > ?2 ORDER BY seq`
  )

  function readBot() {
    const row = db
      .query<BotRecord, [string]>(
        `SELECT id, name, color, provider, model, effort, created_at, seen_at FROM bots WHERE id = ?`
      )
      .get(botId)
    return row ? toBot(row) : null
  }

  function changedThreads() {
    const changed: ThreadRow[] = []
    for (const row of threadQuery.all(botId)) {
      const thread: ThreadRow = {
        id: row.id,
        title: row.title,
        parentId: row.parent_thread_id,
        provider: row.provider,
        model: row.model,
        sessionId: row.session_id,
        status: row.status,
        archived: row.archived !== 0,
      }
      const json = JSON.stringify(thread)
      if (seenThreads.get(row.id) === json) continue
      seenThreads.set(row.id, json)
      changed.push(thread)
    }
    return changed
  }

  function newEvents() {
    const events: EventRow[] = []
    for (const threadId of seenThreads.keys()) {
      for (const row of eventQuery.all(threadId, lastSeq.get(threadId) ?? 0)) {
        events.push({
          threadId,
          seq: row.seq,
          ts: row.ts,
          event: JSON.parse(row.payload_json) as ThreadEvent,
        })
        lastSeq.set(threadId, row.seq)
      }
    }
    return events
  }

  // Every session the bot has had lives in its cwd's folder, so tailing all of them keeps the
  // history when Jetty starts a new session.
  async function newTranscriptLines() {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const lines: TranscriptLine[] = []
    for (const name of names.filter((name) => name.endsWith('.jsonl')).sort()) {
      const file = Bun.file(join(dir, name))
      const tail = tails.get(name) ?? { offset: 0, line: 0 }
      tails.set(name, tail)
      if (file.size < tail.offset) Object.assign(tail, { offset: 0, line: 0 })
      if (file.size === tail.offset) continue
      const bytes = await file.slice(tail.offset, file.size).bytes()
      const end = bytes.lastIndexOf(10)
      if (end === -1) continue
      tail.offset += end + 1
      const session = name.slice(0, -'.jsonl'.length)
      for (const text of new TextDecoder().decode(bytes.subarray(0, end)).split('\n')) {
        tail.line++
        if (!text.trim()) continue
        try {
          lines.push({ file: session, line: tail.line, entry: JSON.parse(text) as TranscriptEntry })
        } catch {}
      }
    }
    return lines
  }

  return {
    async snapshot(): Promise<Snapshot | null> {
      const bot = readBot()
      if (!bot) return null
      const threads = changedThreads()
      return {
        type: 'snapshot',
        bot,
        threads,
        events: newEvents(),
        transcript: await newTranscriptLines(),
        transcriptDir: dir,
      }
    },
    async poll(): Promise<Append | null> {
      const threads = changedThreads()
      const events = newEvents()
      const transcript = await newTranscriptLines()
      if (!threads.length && !events.length && !transcript.length) return null
      return {
        type: 'append',
        ...(threads.length && { threads }),
        ...(events.length && { events }),
        ...(transcript.length && { transcript }),
      }
    },
  }
}
