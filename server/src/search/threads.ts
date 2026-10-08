import type { ThreadItem } from '@jetty/shared/items'

import { Database } from 'bun:sqlite'

import type { EmbedClient } from './types'

import { bm25Scores } from './bm25'
import { chunkProseText } from './chunk'
import { hybridScore } from './lib'
import { blobToFloats, dot, floatsToBlob } from './vec'

export type SearchMessage = {
  id: string
  threadId: string
  author: string
  date: string
  createdAt: number
  text: string
}
export type SearchThread = { id: string; title: string; archived: boolean; lastSeq: number }
export type ThreadUpdate = SearchThread & { messages: SearchMessage[] }

export function searchableMessages(
  items: readonly ThreadItem[],
  thread: SearchThread,
  botId: string,
  botName: string,
  user: string,
  stamp: (date: Date) => string
): SearchMessage[] {
  const messages: SearchMessage[] = []
  for (const item of items) {
    if (item.agentId || (item.kind !== 'user_message' && item.kind !== 'assistant_message'))
      continue
    if (item.kind === 'assistant_message' && (item.private || item.streaming)) continue
    if (item.kind === 'user_message' && (item.reports?.length || item.from?.threadId === thread.id))
      continue
    if (!item.text.trim()) continue
    const author =
      item.kind === 'user_message'
        ? (item.from?.title ?? user)
        : thread.id === botId
          ? botName
          : thread.title
    messages.push({
      id: item.id,
      threadId: thread.id,
      author,
      date: stamp(new Date(item.createdAt)).slice(1, -1),
      createdAt: item.createdAt,
      text: item.text,
    })
  }
  return messages
}

function openThreads(path: string) {
  const db = new Database(path, { create: true })
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS search_threads (id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS search_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, author TEXT NOT NULL, date TEXT NOT NULL, created_at INTEGER NOT NULL, embedder TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS message_chunks (id INTEGER PRIMARY KEY, message_id TEXT NOT NULL, text TEXT NOT NULL, embedding BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS message_chunks_by_message ON message_chunks(message_id);
    CREATE INDEX IF NOT EXISTS search_messages_by_thread ON search_messages(thread_id);`)
  return db
}

export type ThreadCursor = { lastSeq: number; messageIds: string[] }

export function threadCursors(path: string, embedder: string): Record<string, ThreadCursor> {
  const db = openThreads(path)
  try {
    if (db.query('SELECT 1 FROM search_messages WHERE embedder != ? LIMIT 1').get(embedder)) {
      db.transaction(() => {
        db.run('DELETE FROM message_chunks')
        db.run('DELETE FROM search_messages')
        db.run('DELETE FROM search_threads')
      })()
    }
    return Object.fromEntries(
      db
        .query<{ id: string; last_seq: number }, []>('SELECT * FROM search_threads')
        .all()
        .map((row) => [
          row.id,
          {
            lastSeq: row.last_seq,
            messageIds: db
              .query<{ id: string }, [string]>('SELECT id FROM search_messages WHERE thread_id = ?')
              .all(row.id)
              .map((message) => message.id),
          },
        ])
    )
  } finally {
    db.close()
  }
}

export async function reindexThreads(
  path: string,
  scope: SearchThread[],
  updates: ThreadUpdate[],
  embed: EmbedClient
) {
  const db = openThreads(path)
  const started = performance.now()
  try {
    const ids = new Set(scope.map((thread) => thread.id))
    const removed = db
      .query<{ id: string }, []>('SELECT id FROM search_threads')
      .all()
      .filter((row) => !ids.has(row.id))
    const jobs: { message: SearchMessage; text: string; title: string }[] = []
    const messages: SearchMessage[] = []
    let unchanged = 0
    for (const thread of updates) {
      for (const message of thread.messages) {
        if (
          db
            .query('SELECT 1 FROM search_messages WHERE id = ? AND embedder = ?')
            .get(message.id, embed.id)
        ) {
          unchanged++
          continue
        }
        messages.push(message)
        for (const chunk of chunkProseText(message.text))
          jobs.push({ message, text: chunk.text, title: thread.title })
      }
    }
    const vectors: Float32Array[] = []
    for (let i = 0; i < jobs.length; i += 8) {
      vectors.push(
        ...(await embed.embedDocuments(
          jobs.slice(i, i + 8).map((job) => ({
            title: job.title,
            text: `From ${job.message.author}, ${job.message.date}\n\n${job.text}`,
          }))
        ))
      )
    }
    if (vectors.length !== jobs.length)
      throw new Error('embedder returned the wrong number of vectors')
    db.transaction(() => {
      for (const thread of removed) {
        db.run(
          'DELETE FROM message_chunks WHERE message_id IN (SELECT id FROM search_messages WHERE thread_id = ?)',
          [thread.id]
        )
        db.run('DELETE FROM search_messages WHERE thread_id = ?', [thread.id])
        db.run('DELETE FROM search_threads WHERE id = ?', [thread.id])
      }
      for (const message of messages) {
        db.run('DELETE FROM message_chunks WHERE message_id = ?', [message.id])
        db.run('INSERT OR REPLACE INTO search_messages VALUES (?, ?, ?, ?, ?, ?)', [
          message.id,
          message.threadId,
          message.author,
          message.date,
          message.createdAt,
          embed.id,
        ])
      }
      for (const [i, job] of jobs.entries())
        db.run('INSERT INTO message_chunks (message_id, text, embedding) VALUES (?, ?, ?)', [
          job.message.id,
          job.text,
          floatsToBlob(vectors[i]!),
        ])
      for (const thread of updates)
        db.run('INSERT OR REPLACE INTO search_threads VALUES (?, ?)', [thread.id, thread.lastSeq])
    })()
    const chunks = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM message_chunks').get()!.n
    console.error(
      `[search threads] embedded=${messages.length} unchanged=${unchanged} removed=${removed.length} chunks=${chunks} ms=${Math.round(performance.now() - started)}`
    )
    return { embedded: messages.length, unchanged, removed: removed.length, chunks }
  } finally {
    db.close()
  }
}

export async function recallThreads(
  path: string,
  query: string,
  k: number,
  embed: EmbedClient,
  excludeMessageIds: readonly string[] = []
) {
  const db = openThreads(path)
  try {
    const excluded = new Set(excludeMessageIds)
    const rows = db
      .query<SearchMessage & { embedding: Uint8Array }, []>(
        `SELECT m.id, m.thread_id AS threadId, m.author, m.date, m.created_at AS createdAt, c.text, c.embedding FROM message_chunks c JOIN search_messages m ON m.id = c.message_id`
      )
      .all()
      .filter((row) => !excluded.has(row.id))
    if (!rows.length) return []
    const vector = await embed.embedQuery(query.trim())
    const keyword = bm25Scores(
      query,
      rows.map((row) => row.text)
    )
    return rows
      .map((row, i) => {
        const embeddingScore = dot(vector, blobToFloats(row.embedding))
        return {
          messageId: row.id,
          threadId: row.threadId,
          author: row.author,
          date: row.date,
          text: row.text,
          embeddingScore,
          score: hybridScore(embeddingScore, keyword[i]!),
        }
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.embeddingScore - a.embeddingScore ||
          a.threadId.localeCompare(b.threadId) ||
          a.messageId.localeCompare(b.messageId)
      )
      .slice(0, k)
  } finally {
    db.close()
  }
}
