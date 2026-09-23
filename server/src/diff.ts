import { Context, Effect, Layer } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'

import { git } from './git-process'

export type ThreadDiff = { diff: string; truncatedPaths?: string[] }

const LOCKFILE_NAMES = new Set(['bun.lockb', 'package-lock.json', 'pnpm-lock.yaml'])

const MAX_FILE_DIFF_BYTES = 128 * 1024

function isLockfile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return LOCKFILE_NAMES.has(base) || base.endsWith('.lock')
}

function filePath(section: string): string | null {
  const plus = section.match(/^\+\+\+ b\/(.+)$/m)
  if (plus?.[1] && plus[1] !== '/dev/null') return plus[1]
  const header = section.match(/^diff --git a\/.+ b\/(.+)$/m)
  return header?.[1] ?? null
}

export function truncateDiff(diff: string): ThreadDiff {
  if (diff.trim().length === 0) return { diff: '' }
  const sections = diff.split(/(?=^diff --git )/m).filter((s) => s.length > 0)
  const kept: string[] = []
  const truncated: string[] = []
  for (const section of sections) {
    const path = filePath(section)
    if (path && (isLockfile(path) || Buffer.byteLength(section) > MAX_FILE_DIFF_BYTES)) {
      truncated.push(path)
      continue
    }
    kept.push(section)
  }
  return truncated.length > 0
    ? { diff: kept.join(''), truncatedPaths: truncated }
    : { diff: kept.join('') }
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// Keeps non-ASCII paths readable in diff headers instead of octal-escaped.
const diffArgs = ['-c', 'core.quotePath=false', 'diff']

export function computeThreadDiff(cwd: string) {
  return Effect.gen(function* () {
    const head = yield* git(cwd, ['rev-parse', '--verify', 'HEAD'])
    const tracked = yield* git(cwd, [...diffArgs, head.code === 0 ? 'HEAD' : EMPTY_TREE])
    if (tracked.code !== 0) return { diff: '' }
    const untracked = yield* git(cwd, ['ls-files', '-z', '--others', '--exclude-standard'])
    const parts = [tracked.out]
    for (const path of untracked.out.split('\0').filter((line) => line.length > 0)) {
      // --no-index exits 1 when the file has content; that's the success case.
      const { out } = yield* git(cwd, [...diffArgs, '--no-index', '--', '/dev/null', path])
      parts.push(out)
    }
    return truncateDiff(parts.join(''))
  })
}

export const GitDiff = Context.Service<{
  computeThreadDiff: (cwd: string) => Effect.Effect<ThreadDiff>
}>('jetty/GitDiff')

export const GitDiffLive = Layer.effect(
  GitDiff,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return {
      computeThreadDiff: (cwd: string) =>
        computeThreadDiff(cwd).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
        ),
    }
  })
)
