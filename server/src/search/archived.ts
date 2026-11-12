import type { ThreadItem } from '@jetty/shared/items'

import { matchArchivedMessages, prepareArchivedMessage } from '@jetty/shared/search'
import { Effect } from 'effect'

import type { Store } from '../store'

import { archivedMessageText } from './threads'

type Cached = {
  lastSeq: number
  text: string
  tokens: readonly string[]
  bm25: readonly string[]
}

// Filled on the first message search, then reused while the thread stays archived
// at the same sequence. Opening the settings page never reads message text.
const cachedMessages = new Map<string, Cached>()

function remember(id: string, lastSeq: number, items: readonly ThreadItem[]) {
  try {
    const text = archivedMessageText(items, id)
    const entry = { lastSeq, text, ...prepareArchivedMessage(text) }
    cachedMessages.set(id, entry)
    return entry
  } catch {
    return undefined
  }
}

function itemsFromState(json: string): ThreadItem[] | undefined {
  try {
    const parsed = JSON.parse(json) as { items?: unknown }
    return Array.isArray(parsed.items) ? (parsed.items as ThreadItem[]) : undefined
  } catch {
    return undefined
  }
}

export function searchArchivedThreads(store: Store, query: string) {
  if (!query.trim()) return Effect.succeed({ hits: [] })
  return Effect.gen(function* () {
    const cursors = yield* store.listArchivedCursors()
    const byId = new Map(cursors.map((cursor) => [cursor.id, cursor]))
    const docs: (Cached & { id: string })[] = []
    const read: string[] = []
    const replay: string[] = []

    for (const cursor of cursors) {
      const hit = cachedMessages.get(cursor.id)
      if (hit && hit.lastSeq === cursor.lastSeq) {
        docs.push({ id: cursor.id, ...hit })
        continue
      }
      if (cursor.items) {
        const entry = remember(cursor.id, cursor.lastSeq, cursor.items)
        if (entry) docs.push({ id: cursor.id, ...entry })
        continue
      }
      if (cursor.replay) replay.push(cursor.id)
      else read.push(cursor.id)
    }

    if (read.length > 0) {
      const rows = yield* store.readThreadStates(read)
      const jsonById = new Map(rows.map((row) => [row.id, row.stateJson]))
      for (const id of read) {
        const cursor = byId.get(id)
        const items = itemsFromState(jsonById.get(id) ?? '')
        const entry = cursor && items ? remember(id, cursor.lastSeq, items) : undefined
        if (entry) docs.push({ id, ...entry })
        else replay.push(id)
      }
    }

    for (const id of replay) {
      const state = yield* store
        .getThreadState(id)
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!state) continue
      const entry = remember(id, state.lastSeq, state.items)
      if (entry) docs.push({ id, ...entry })
    }

    for (const id of cachedMessages.keys()) {
      if (!byId.has(id)) cachedMessages.delete(id)
    }
    return { hits: matchArchivedMessages(query, docs) }
  })
}
