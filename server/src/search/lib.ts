import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { bm25Scores, squashBm25 } from './bm25'
import { chunkFile, type Chunk } from './chunk'
import { openSearchDb } from './db'
import { hashBytes, listMemoryFiles } from './walk'

export type RecallHit = {
  path: string
  startLine: number
  endLine: number
  score: number
  text: string
}

export type ReindexStats = {
  files: number
  indexed: number
  unchanged: number
  removed: number
  chunks: number
}

type ChunkRow = {
  path: string
  start_line: number
  end_line: number
  text: string
  modified_at: number
}

export async function reindex(home: string, dbPath: string): Promise<ReindexStats> {
  const homeAbs = resolve(home)
  const dbAbs = resolve(dbPath)
  if (!existsSync(homeAbs)) throw new Error(`home not found: ${homeAbs}`)
  await mkdir(dirname(dbAbs), { recursive: true })
  const files = await listMemoryFiles(homeAbs)
  const db = openSearchDb(dbAbs)
  try {
    const existing = new Map(
      db
        .query<{ path: string; hash: string }, []>('SELECT path, hash FROM files')
        .all()
        .map((row) => [row.path, row.hash])
    )
    const seen = new Set<string>()
    const changed: { rel: string; hash: string; modifiedAt: number; chunks: Chunk[] }[] = []
    let unchanged = 0
    for (const file of files) {
      seen.add(file.rel)
      const hash = hashBytes(file.bytes)
      if (existing.get(file.rel) === hash) {
        unchanged++
        continue
      }
      const text = new TextDecoder('utf-8', { fatal: false }).decode(file.bytes)
      changed.push({
        rel: file.rel,
        hash,
        modifiedAt: file.modifiedAt,
        chunks: chunkFile(file.rel, text),
      })
    }
    const removed = [...existing.keys()].filter((rel) => !seen.has(rel))
    const insert = db.query(
      'INSERT INTO chunks (path, start_line, end_line, text) VALUES (?, ?, ?, ?)'
    )
    db.transaction(() => {
      for (const rel of [...changed.map((file) => file.rel), ...removed]) {
        db.run('DELETE FROM chunks WHERE path = ?', [rel])
        db.run('DELETE FROM files WHERE path = ?', [rel])
      }
      for (const file of changed) {
        for (const chunk of file.chunks)
          insert.run(file.rel, chunk.startLine, chunk.endLine, chunk.text)
        db.run('INSERT INTO files (path, hash, modified_at) VALUES (?, ?, ?)', [
          file.rel,
          file.hash,
          file.modifiedAt,
        ])
      }
    })()
    const chunks = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM chunks').get()!.n
    return {
      files: files.length,
      indexed: changed.length,
      unchanged,
      removed: removed.length,
      chunks,
    }
  } finally {
    db.close()
  }
}

export function recall(dbPath: string, query: string, k = 5): RecallHit[] {
  if (!Number.isInteger(k) || k < 1) throw new Error(`k must be a positive integer, got ${k}`)
  if (!query.trim()) throw new Error('query is empty')
  const db = openSearchDb(resolve(dbPath))
  try {
    const rows = db
      .query<ChunkRow, []>(
        'SELECT c.path, c.start_line, c.end_line, c.text, f.modified_at FROM chunks c JOIN files f ON f.path = c.path'
      )
      .all()
    const scores = bm25Scores(
      query,
      rows.map((row) => row.text)
    )
    return rows
      .map((row, i) => ({
        modifiedAt: row.modified_at,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        text: row.text,
        score: squashBm25(scores[i]!),
      }))
      .filter((hit) => hit.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.modifiedAt - a.modifiedAt ||
          a.path.localeCompare(b.path) ||
          a.startLine - b.startLine
      )
      .slice(0, k)
  } finally {
    db.close()
  }
}
