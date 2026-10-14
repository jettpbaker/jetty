import type { ThreadItem } from '@jetty/shared/items'

import { databases } from '@/platform'
import { ThreadSnapshot, omitToolOutput } from '@jetty/shared/history'
import { Schema } from 'effect'

import type { ThreadView } from './history_merge'

const version = import.meta.env.JETTY_VERSION
const removed = new Set<string>()
let database: Promise<IDBDatabase | undefined> | undefined

function openDatabase() {
  if (!database)
    database = databases
      .open('jetty-thread-cache', 1, (db) => {
        db.createObjectStore('threads')
        db.createObjectStore('opened').createIndex('recent', '')
      })
      .catch(() => undefined)
  return database
}

function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

function evict(transaction: IDBTransaction) {
  let count = 0
  const request = transaction.objectStore('opened').index('recent').openKeyCursor(null, 'prev')
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    if (++count > 50) {
      transaction.objectStore('threads').delete(cursor.primaryKey)
      transaction.objectStore('opened').delete(cursor.primaryKey)
    }
    cursor.continue()
  }
}

export async function touchThreadCache(threadId: string) {
  try {
    const db = await openDatabase()
    if (!db || removed.has(threadId)) return
    const transaction = db.transaction(['threads', 'opened'], 'readwrite')
    transaction.objectStore('opened').put(Date.now(), threadId)
    evict(transaction)
    await completed(transaction)
  } catch {}
}

const entrySchema = Schema.Struct({ version: Schema.String, state: ThreadSnapshot })
const decode = Schema.decodeUnknownSync(entrySchema)

export async function readThreadCache(threadId: string) {
  try {
    const db = await openDatabase()
    if (!db || removed.has(threadId)) return
    const raw = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('threads').objectStore('threads').get(threadId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (raw === undefined || removed.has(threadId)) return
    try {
      const entry = decode(raw)
      if (entry.version === version) return entry.state
    } catch {}
    await dropThreadCache([threadId], false)
  } catch {}
}

export async function dropThreadCache(threadIds: readonly string[], deleted = true) {
  if (deleted) for (const id of threadIds) removed.add(id)
  try {
    const db = await openDatabase()
    if (!db) return
    const transaction = db.transaction(['threads', 'opened'], 'readwrite')
    for (const id of threadIds) {
      transaction.objectStore('threads').delete(id)
      if (deleted) transaction.objectStore('opened').delete(id)
    }
    await completed(transaction)
  } catch {}
}

export async function pruneThreadCache(threadIds: readonly string[]) {
  try {
    const db = await openDatabase()
    if (!db) return
    const keep = new Set(threadIds)
    const transaction = db.transaction(['threads', 'opened'], 'readwrite')
    const request = transaction.objectStore('opened').openKeyCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const id = String(cursor.primaryKey)
      if (!keep.has(id)) {
        removed.add(id)
        transaction.objectStore('threads').delete(id)
        transaction.objectStore('opened').delete(id)
      }
      cursor.continue()
    }
    await completed(transaction)
  } catch {}
}

function newestWindow(state: ThreadView): ThreadSnapshot {
  const start = state.newestStart ?? state.history?.ranges[0]?.start ?? 0
  const ranges = state.history?.ranges ?? [{ start: 0, end: state.items.length }]
  let offset = 0
  const items: ThreadItem[] = []
  for (const range of ranges) {
    const length = range.end - range.start
    for (let index = offset + Math.max(0, start - range.start); index < offset + length; index++)
      items.push(state.items[index]!)
    offset += length
  }
  const summary = state.summary
    ? { ...state.summary, items: state.summary.items.map(omitToolOutput) }
    : undefined
  const turns = new Set([...items, ...(summary?.items ?? [])].map((item) => item.turnId))
  const ids = new Set(items.map((item) => item.id))
  return {
    items: items.map(omitToolOutput),
    status: state.status,
    activeTurnId: state.activeTurnId,
    lastSeq: state.lastSeq,
    context: state.context,
    lastTurnOutcome: state.lastTurnOutcome,
    turnOutcomes: Object.fromEntries(
      Object.entries(state.turnOutcomes).filter(([id]) => turns.has(id))
    ),
    turnLoadouts: Object.fromEntries(
      Object.entries(state.turnLoadouts).filter(([id]) => turns.has(id))
    ),
    ...(state.history && {
      history: {
        total: state.history.total,
        ranges: ranges
          .filter((range) => range.end >= start)
          .map((range) => ({ ...range, start: Math.max(start, range.start) })),
        todoUpdates: Object.fromEntries(
          Object.entries(state.history.todoUpdates).filter(([id]) => ids.has(id))
        ),
      },
    }),
    ...(summary && { summary }),
  }
}

async function saveThreadCache(threadId: string, state: ThreadView) {
  try {
    const db = await openDatabase()
    if (!db || removed.has(threadId)) return
    const snapshot = newestWindow(state)
    const transaction = db.transaction(['threads', 'opened'], 'readwrite')
    const request = transaction.objectStore('opened').get(threadId)
    request.onsuccess = () => {
      if (request.result === undefined) return
      transaction.objectStore('threads').put({ version, state: snapshot }, threadId)
      evict(transaction)
    }
    await completed(transaction)
  } catch {}
}

function streaming(state: ThreadView) {
  return (
    state.status === 'starting' ||
    state.status === 'running' ||
    state.items.some((item) => 'streaming' in item && item.streaming)
  )
}

export function createThreadSaver(threadId: string) {
  let current: ThreadView | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let savedAt: number | undefined
  let disposed = false

  function schedule() {
    if (disposed || timer || !current || streaming(current)) return
    const delay = savedAt === undefined ? 500 : Math.max(0, savedAt + 10_000 - Date.now())
    timer = setTimeout(() => {
      timer = undefined
      if (!current || streaming(current)) return
      savedAt = Date.now()
      void saveThreadCache(threadId, current)
    }, delay)
  }

  return {
    update(state: ThreadView) {
      current = state
      schedule()
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      current = undefined
    },
  }
}
