import { Context, Effect, Layer } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'

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

export function searchFiles(cwd: string, query: string, limit = DEFAULT_LIMIT) {
  return Effect.gen(function* () {
    if (query.length === 0) return []
    const { out, code } = yield* git(cwd, ['ls-files'])
    if (code !== 0) return []

    const scored: { path: string; score: number }[] = []
    for (const path of out.split('\n')) {
      if (path.length === 0) continue
      const score = fuzzyMatch(path, query)
      if (score !== null) scored.push({ path, score })
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    return scored.slice(0, limit).map((s) => s.path)
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
