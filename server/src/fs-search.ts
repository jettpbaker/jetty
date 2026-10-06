import { Context, Effect, Layer } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'

import { git } from './git-process'

const DEFAULT_LIMIT = 20

export function fuzzyMatch(path: string, query: string): number | null {
  if (query.length === 0) return null

  const p = path.toLowerCase()
  const q = query.toLowerCase()
  const basenameStart = p.lastIndexOf('/') + 1

  let pi = 0
  let score = 0
  let run = 0
  let basenameHits = 0

  for (let qi = 0; qi < q.length; qi++) {
    const found = p.indexOf(q[qi]!, pi)
    if (found < 0) return null

    if (qi > 0 && found === pi) {
      run++
      score += 5 + run
    } else {
      run = 0
      score += 1
    }

    if (found >= basenameStart) basenameHits++
    pi = found + 1
  }

  return score + basenameHits * 10 - p.length * 0.001
}

type Candidate = { path: string; score: number }

function compare(a: Candidate, b: Candidate) {
  return b.score - a.score || a.path.localeCompare(b.path)
}

export function rankFiles(out: string, query: string, limit: number) {
  return Effect.gen(function* () {
    const best: Candidate[] = []
    const count = Math.min(50, Math.max(0, Math.floor(limit)))
    if (!count || !query) return []
    let start = 0
    let scanned = 0
    while (start < out.length) {
      const end = out.indexOf('\0', start)
      const path = out.slice(start, end < 0 ? out.length : end)
      start = end < 0 ? out.length : end + 1
      const score = fuzzyMatch(path, query)
      if (path && score !== null) {
        const candidate = { path, score }
        if (best.length < count) {
          best.push(candidate)
          let at = best.length - 1
          while (at > 0) {
            const parent = (at - 1) >> 1
            if (compare(best[parent]!, candidate) >= 0) break
            best[at] = best[parent]!
            at = parent
          }
          best[at] = candidate
        } else if (compare(candidate, best[0]!) < 0) {
          let at = 0
          while (at * 2 + 1 < best.length) {
            let child = at * 2 + 1
            if (child + 1 < best.length && compare(best[child + 1]!, best[child]!) > 0) child++
            if (compare(candidate, best[child]!) >= 0) break
            best[at] = best[child]!
            at = child
          }
          best[at] = candidate
        }
      }
      if (++scanned % 1000 === 0) yield* Effect.promise(() => setImmediate())
    }
    return best.sort(compare).map((candidate) => candidate.path)
  })
}

const indexes = new Map<
  string,
  { out: string; at: number; spawner: ReturnType<typeof ChildProcessSpawner.make> }
>()
const indexFreshMs = 2000
const maxIndexCharacters = 32 * 1024 * 1024
// `git ls-files` exits 128 when the folder isn't a repository (and when it isn't there).
const notARepository = 128
const maxWalkedFiles = 20_000
// Top-level folders that fill ~/.claude with session logs, history, snapshots and caches,
// not files anyone edits. `.git` and `node_modules` are skipped at any depth.
const skippedAtRoot = new Set([
  'projects',
  'todos',
  'shell-snapshots',
  'statsig',
  'file-history',
  'cache',
])

// The same NUL-separated relative paths `git ls-files -z` prints, for a folder that isn't a repo.
function walkFiles(root: string) {
  const paths: string[] = []
  const pending = ['']
  let cursor = 0
  while (cursor < pending.length && paths.length < maxWalkedFiles) {
    const folder = pending[cursor++]!
    let entries: Dirent[]
    try {
      entries = readdirSync(join(root, folder), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (paths.length >= maxWalkedFiles) break
      const path = folder ? `${folder}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        // A link to a folder is not a file to open, and the walk doesn't follow it.
        let directory = false
        try {
          directory = statSync(join(root, path)).isDirectory()
        } catch {
          directory = false
        }
        if (!directory) paths.push(path)
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        if (folder === '' && skippedAtRoot.has(entry.name)) continue
        pending.push(path)
        continue
      }
      if (entry.isFile()) paths.push(path)
    }
  }
  return paths.join('\0')
}

export function searchFiles(cwd: string, query: string, limit = DEFAULT_LIMIT) {
  return Effect.gen(function* () {
    if (query.length === 0) return []
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const cached = indexes.get(cwd)
    let out: string
    if (cached?.spawner === spawner && Date.now() - cached.at < indexFreshMs) out = cached.out
    else {
      // Git's NUL-separated names stay in one index; scoring slices them as it yields.
      const result = yield* git(cwd, [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
      ])
      if (result.code !== 0 && result.code !== notARepository) {
        indexes.delete(cwd)
        return []
      }
      out = result.code === 0 ? result.out : walkFiles(cwd)
      indexes.delete(cwd)
      let characters = out.length
      for (const index of indexes.values()) characters += index.out.length
      for (const [key, index] of indexes) {
        if (characters <= maxIndexCharacters && indexes.size < 32) break
        indexes.delete(key)
        characters -= index.out.length
      }
      if (out.length <= maxIndexCharacters) indexes.set(cwd, { out, at: Date.now(), spawner })
    }
    return yield* rankFiles(out, query, limit)
  })
}

export const FileSearch = Context.Service<{
  searchFiles: (cwd: string, query: string, limit?: number) => Effect.Effect<string[]>
}>('jetty/FileSearch')

export const FileSearchLive = Layer.effect(
  FileSearch,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return {
      searchFiles: (cwd: string, query: string, limit?: number) =>
        searchFiles(cwd, query, limit).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
        ),
    }
  })
)
