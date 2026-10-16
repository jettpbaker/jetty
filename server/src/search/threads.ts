import type { ThreadItem } from '@jetty/shared/items'

import { setImmediate } from 'node:timers/promises'

import { bm25Scores, squashBm25 } from './bm25'
import { chunkProseText } from './chunk'
import { openSearchDb } from './db'

export type SearchMessage = {
  id: string
  threadId: string
  author: string
  assistant: boolean
  date: string
  createdAt: number
  text: string
}
export type SearchThread = { id: string; title: string; archived: boolean; lastSeq: number }
export type ThreadUpdate = SearchThread & { changedIds: string[]; messages: SearchMessage[] }

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
      assistant: item.kind === 'assistant_message',
      date: stamp(new Date(item.createdAt)).slice(1, -1),
      createdAt: item.createdAt,
      text: item.text,
    })
  }
  return messages
}

// How much of a thread's messages the archived search reads. The rest is not indexed.
export const ARCHIVED_MESSAGE_TEXT_MAX = 80_000

export function archivedMessageText(items: readonly ThreadItem[], threadId: string) {
  const text = searchableMessages(
    items,
    { id: threadId, title: '', archived: true, lastSeq: 0 },
    '',
    '',
    '',
    () => ''
  )
    .map((message) => message.text)
    .join('\n')
  return text.length > ARCHIVED_MESSAGE_TEXT_MAX ? text.slice(0, ARCHIVED_MESSAGE_TEXT_MAX) : text
}

export type ThreadCursor = { lastSeq: number }

export function threadCursors(path: string): Record<string, ThreadCursor> {
  const db = openSearchDb(path)
  try {
    return Object.fromEntries(
      db
        .query<{ id: string; last_seq: number }, []>('SELECT * FROM search_threads')
        .all()
        .map((row) => [row.id, { lastSeq: row.last_seq }])
    )
  } finally {
    db.close()
  }
}

export async function reindexThreads(path: string, scope: SearchThread[], updates: ThreadUpdate[]) {
  const db = openSearchDb(path)
  try {
    const ids = new Set(scope.map((thread) => thread.id))
    const removed = db
      .query<{ id: string }, []>('SELECT id FROM search_threads')
      .all()
      .filter((row) => !ids.has(row.id))
    db.transaction(() => {
      for (const thread of removed) {
        db.run(
          'DELETE FROM message_chunks WHERE message_id IN (SELECT id FROM search_messages WHERE thread_id = ?)',
          [thread.id]
        )
        db.run('DELETE FROM search_messages WHERE thread_id = ?', [thread.id])
        db.run('DELETE FROM search_threads WHERE id = ?', [thread.id])
      }
    })()
    for (const thread of updates) {
      db.transaction(() => {
        // Changed items can become ineligible (private or blank), so remove their old chunks too.
        for (const id of thread.changedIds) {
          db.run('DELETE FROM message_chunks WHERE message_id = ?', [id])
          db.run('DELETE FROM search_messages WHERE id = ?', [id])
        }
        for (const message of thread.messages) {
          db.run('INSERT OR REPLACE INTO search_messages VALUES (?, ?, ?, ?, ?, ?)', [
            message.id,
            message.threadId,
            message.author,
            Number(message.assistant),
            message.date,
            message.createdAt,
          ])
          for (const chunk of chunkProseText(message.text))
            db.run('INSERT INTO message_chunks (message_id, text) VALUES (?, ?)', [
              message.id,
              chunk.text,
            ])
        }
        db.run('INSERT OR REPLACE INTO search_threads VALUES (?, ?)', [thread.id, thread.lastSeq])
      })()
      await setImmediate()
    }
    return {
      indexed: updates.reduce((n, thread) => n + thread.messages.length, 0),
      removed: removed.length,
    }
  } finally {
    db.close()
  }
}

export function recallThreads(
  path: string,
  query: string,
  k: number,
  excludeMessageIds: readonly string[] = []
) {
  const db = openSearchDb(path)
  try {
    const excluded = new Set(excludeMessageIds)
    const rows = db
      .query<SearchMessage, []>(
        `SELECT m.id, m.thread_id AS threadId, m.author, m.assistant, m.date, m.created_at AS createdAt, c.text FROM message_chunks c JOIN search_messages m ON m.id = c.message_id`
      )
      .all()
      .filter((row) => !excluded.has(row.id))
    const keyword = bm25Scores(
      query,
      rows.map((row) => row.text)
    )
    return rows
      .map((row, i) => ({
        messageId: row.id,
        threadId: row.threadId,
        author: row.author,
        assistant: Boolean(row.assistant),
        date: row.date,
        text: row.text,
        createdAt: row.createdAt,
        score: squashBm25(keyword[i]!),
      }))
      .filter((hit) => hit.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.createdAt - a.createdAt ||
          a.threadId.localeCompare(b.threadId) ||
          a.messageId.localeCompare(b.messageId)
      )
      .slice(0, k)
  } finally {
    db.close()
  }
}
