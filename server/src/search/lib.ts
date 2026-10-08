import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { EmbedClient } from './types'

import { bm25Scores, squashBm25 } from './bm25'
import { chunkFile, type Chunk } from './chunk'
import { blobToFloats, dot, floatsToBlob } from './vec'
import { hashBytes, listMemoryFiles } from './walk'

export const EMBED_WEIGHT = 0.7
export const BM25_WEIGHT = 0.3

export type RecallHit = {
  path: string
  startLine: number
  endLine: number
  score: number
  text: string
  embeddingScore: number
  bm25Score: number
}

export type ReindexStats = {
  files: number
  embedded: number
  unchanged: number
  removed: number
  chunks: number
  model: string
}

export type ReindexOptions = {
  embed: EmbedClient
  onProgress?: (message: string) => void
  batchSize?: number
}

export type RecallOptions = {
  embed: EmbedClient
}

type ChunkRow = {
  path: string
  start_line: number
  end_line: number
  text: string
  embedding: Uint8Array
}

export function hybridScore(embeddingScore: number, bm25Score: number): number {
  const cosine = Math.max(0, Math.min(1, embeddingScore))
  return EMBED_WEIGHT * cosine + BM25_WEIGHT * squashBm25(bm25Score)
}

export function formatHits(hits: RecallHit[]): string {
  return hits
    .map(
      (hit) => `${hit.path}:${hit.startLine}-${hit.endLine} (${hit.score.toFixed(3)})\n${hit.text}`
    )
    .join('\n\n')
}

export async function reindex(
  home: string,
  dbPath: string,
  options: ReindexOptions
): Promise<ReindexStats> {
  const homeAbs = resolve(home)
  const dbAbs = resolve(dbPath)
  if (!existsSync(homeAbs)) throw new Error(`home not found: ${homeAbs}`)
  await mkdir(dirname(dbAbs), { recursive: true })

  const embedder = options.embed
  const files = await listMemoryFiles(homeAbs)
  const db = openDb(dbAbs)
  try {
    const existing = new Map(
      db
        .query<{ path: string; hash: string; embedder: string }, []>(
          'SELECT path, hash, embedder FROM files'
        )
        .all()
        .map((row) => [row.path, row])
    )
    const seen = new Set<string>()
    const changed: { rel: string; hash: string; chunks: Chunk[] }[] = []
    let unchanged = 0
    for (const file of files) {
      seen.add(file.rel)
      const hash = hashBytes(file.bytes)
      const prev = existing.get(file.rel)
      if (prev && prev.hash === hash && prev.embedder === embedder.id) {
        unchanged++
        continue
      }
      const text = new TextDecoder('utf-8', { fatal: false }).decode(file.bytes)
      changed.push({ rel: file.rel, hash, chunks: chunkFile(file.rel, text) })
    }
    const removed = [...existing.keys()].filter((rel) => !seen.has(rel))

    const jobs: { rel: string; chunk: Chunk }[] = []
    for (const file of changed) {
      for (const chunk of file.chunks) jobs.push({ rel: file.rel, chunk })
    }
    const vectors: Float32Array[] = []
    if (jobs.length > 0) {
      const batchSize = options.batchSize ?? 8
      for (let i = 0; i < jobs.length; i += batchSize) {
        const batch = jobs.slice(i, i + batchSize)
        const part = await embedder.embedDocuments(
          batch.map((job) => ({
            title: job.chunk.title,
            text: job.chunk.context ? `${job.chunk.context}\n\n${job.chunk.text}` : job.chunk.text,
          }))
        )
        if (part.length !== batch.length)
          throw new Error('embedder returned the wrong number of vectors')
        vectors.push(...part)
        options.onProgress?.(
          `embedded ${Math.min(i + batchSize, jobs.length)}/${jobs.length} chunks`
        )
      }
      const dim = vectors[0]!.length
      const prevDim = metaGet(db, 'dim')
      if (prevDim && Number(prevDim) !== dim && unchanged > 0) {
        throw new Error(
          `embedding dim changed from ${prevDim} to ${dim} with unchanged files still in the db`
        )
      }
    }

    const insert = db.query(
      'INSERT INTO chunks (path, start_line, end_line, text, embedding) VALUES (?, ?, ?, ?, ?)'
    )
    const tx = db.transaction(() => {
      for (const file of changed) {
        db.run('DELETE FROM chunks WHERE path = ?', [file.rel])
        db.run('DELETE FROM files WHERE path = ?', [file.rel])
      }
      for (const rel of removed) {
        db.run('DELETE FROM chunks WHERE path = ?', [rel])
        db.run('DELETE FROM files WHERE path = ?', [rel])
      }
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]!
        insert.run(
          job.rel,
          job.chunk.startLine,
          job.chunk.endLine,
          job.chunk.text,
          floatsToBlob(vectors[i]!)
        )
      }
      for (const file of changed) {
        db.run('INSERT INTO files (path, hash, embedder) VALUES (?, ?, ?)', [
          file.rel,
          file.hash,
          embedder.id,
        ])
      }
      if (vectors[0]!) metaSet(db, 'dim', String(vectors[0]!.length))
      metaSet(db, 'embedder', embedder.id)
    })
    tx()

    const chunks = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM chunks').get()?.n ?? 0
    return {
      files: files.length,
      embedded: changed.length,
      unchanged,
      removed: removed.length,
      chunks,
      model: embedder.id,
    }
  } finally {
    db.close()
  }
}

export async function recall(
  dbPath: string,
  query: string,
  k = 5,
  options: RecallOptions
): Promise<RecallHit[]> {
  if (!Number.isInteger(k) || k < 1) throw new Error(`k must be a positive integer, got ${k}`)
  const ranked = await rankAll(dbPath, query, options)
  return ranked.slice(0, k)
}

export async function rankAll(
  dbPath: string,
  query: string,
  options: RecallOptions
): Promise<RecallHit[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error('query is empty')
  const embedder = options.embed
  const dbAbs = resolve(dbPath)
  if (!existsSync(dbAbs)) throw new Error(`db not found: ${dbAbs}`)
  const db = openDb(dbAbs)
  try {
    const embedderId = metaGet(db, 'embedder')
    if (!embedderId) return []
    if (embedderId !== embedder.id) {
      throw new Error(`index was built with ${embedderId}, but this process uses ${embedder.id}`)
    }
    const rows = db
      .query<ChunkRow, []>('SELECT path, start_line, end_line, text, embedding FROM chunks')
      .all()
    if (rows.length === 0) return []
    const queryVector = await embedder.embedQuery(trimmed)
    const keyword = bm25Scores(
      trimmed,
      rows.map((row) => row.text)
    )
    const hits: RecallHit[] = rows.map((row, i) => {
      const embeddingScore = dot(queryVector, blobToFloats(row.embedding))
      const bm25Score = keyword[i] ?? 0
      return {
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        text: row.text,
        embeddingScore,
        bm25Score,
        score: hybridScore(embeddingScore, bm25Score),
      }
    })
    hits.sort(
      (a, b) =>
        b.score - a.score || b.embeddingScore - a.embeddingScore || a.path.localeCompare(b.path)
    )
    return hits
  } finally {
    db.close()
  }
}

function openDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      embedder TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_by_path ON chunks(path);
  `)
  return db
}

function metaGet(db: Database, key: string): string | null {
  return (
    db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key)?.value ??
    null
  )
}

function metaSet(db: Database, key: string, value: string): void {
  db.run(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  )
}
