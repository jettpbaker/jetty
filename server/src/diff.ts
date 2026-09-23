import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'

import { git } from './git-process'
import { StoreError } from './store'

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

export function computeThreadDiff(cwd: string, baseCommit?: string) {
  return Effect.gen(function* () {
    const head = yield* git(cwd, ['rev-parse', '--verify', 'HEAD'])
    const tracked = yield* git(cwd, [
      ...diffArgs,
      head.code === 0 ? (baseCommit ?? 'HEAD') : EMPTY_TREE,
    ])
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

type Unavailable = { unavailable: 'tooLarge' | 'binary' }
export type DiffFile = { before: string | null; after: string | null } | Unavailable

const MAX_CONTENTS_BYTES = 1024 * 1024
const tooLarge: Unavailable = { unavailable: 'tooLarge' }
const binary: Unavailable = { unavailable: 'binary' }

function isRepoPath(path: string) {
  return (
    !path.includes('\0') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

function readHead(root: string, path: string, baseCommit = 'HEAD') {
  return Effect.gen(function* () {
    const size = yield* git(root, ['cat-file', '-s', `${baseCommit}:${path}`])
    if (size.code !== 0) return null
    if (Number(size.out) > MAX_CONTENTS_BYTES) return tooLarge
    const { out, code } = yield* git(root, ['cat-file', 'blob', `${baseCommit}:${path}`])
    if (code !== 0) return null
    return out.includes('\0') ? binary : out
  })
}

function readWorkingTree(root: string, repoPath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.join(root, repoPath)
    const dir = yield* fs.realPath(path.dirname(file)).pipe(Effect.option)
    if (Option.isNone(dir)) return null
    if (dir.value !== root && !dir.value.startsWith(root + path.sep))
      return yield* Effect.fail(
        new StoreError('invalid_params', `${repoPath} is outside the repository`)
      )
    // Git diffs a symlink's target path, never the file it points at.
    const link = yield* fs.readLink(file).pipe(Effect.option)
    if (Option.isSome(link)) return link.value
    const stat = yield* fs.stat(file).pipe(Effect.option)
    if (Option.isNone(stat) || stat.value.type !== 'File') return null
    if (Number(stat.value.size) > MAX_CONTENTS_BYTES) return tooLarge
    const bytes = yield* fs.readFile(file).pipe(Effect.option)
    if (Option.isNone(bytes)) return null
    return bytes.value.includes(0) ? binary : new TextDecoder().decode(bytes.value)
  })
}

// Paths are repository-relative, as `git diff` prints them.
export function readDiffFile(cwd: string, path: string, prevPath = path, baseCommit?: string) {
  return Effect.gen(function* () {
    if (!isRepoPath(path) || !isRepoPath(prevPath))
      return yield* Effect.fail(new StoreError('invalid_params', `Invalid path: ${path}`))
    const fs = yield* FileSystem.FileSystem
    const top = yield* git(cwd, ['rev-parse', '--show-toplevel'])
    const root = yield* fs.realPath(top.out.trim()).pipe(Effect.option)
    if (top.code !== 0 || Option.isNone(root))
      return yield* Effect.fail(new StoreError('invalid_params', 'Not a git repository'))
    const before = yield* readHead(root.value, prevPath, baseCommit)
    if (typeof before === 'object' && before) return before
    const after = yield* readWorkingTree(root.value, path)
    if (typeof after === 'object' && after) return after
    return { before, after }
  })
}

export type ProjectFile = { contents: string | null } | Unavailable

// Paths are relative to the thread's project; symlinks may not lead outside it.
export function readProjectFile(cwd: string, path: string) {
  return Effect.gen(function* () {
    if (!isRepoPath(path))
      return yield* Effect.fail(new StoreError('invalid_params', `Invalid path: ${path}`))
    const fs = yield* FileSystem.FileSystem
    const paths = yield* Path.Path
    const root = yield* fs.realPath(cwd).pipe(Effect.option)
    if (Option.isNone(root))
      return yield* Effect.fail(new StoreError('not_found', 'Project folder not found'))
    let file = yield* fs.realPath(paths.join(root.value, path)).pipe(Effect.option)
    if (Option.isNone(file)) {
      const top = yield* git(root.value, ['rev-parse', '--show-toplevel'])
      if (top.code === 0)
        file = yield* fs.realPath(paths.join(top.out.trim(), path)).pipe(Effect.option)
    }
    if (Option.isNone(file)) return { contents: null }
    if (!file.value.startsWith(root.value + paths.sep))
      return yield* Effect.fail(new StoreError('invalid_params', `${path} is outside the project`))
    const opened = yield* Effect.promise(async () => {
      try {
        const handle = await open(file.value, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const [actual, fromHandle, fromPath] = await Promise.all([
            realpath(file.value),
            handle.stat(),
            stat(file.value),
          ])
          if (
            actual !== file.value ||
            fromHandle.dev !== fromPath.dev ||
            fromHandle.ino !== fromPath.ino
          )
            return { changed: true } as const
          if (!fromHandle.isFile()) return { contents: null } as const
          if (fromHandle.size > MAX_CONTENTS_BYTES) return tooLarge
          return { bytes: await handle.readFile() } as const
        } finally {
          await handle.close()
        }
      } catch {
        return { contents: null } as const
      }
    })
    if ('changed' in opened)
      return yield* Effect.fail(new StoreError('invalid_params', 'File changed while opening'))
    if ('unavailable' in opened && opened.unavailable) return tooLarge
    const bytes = 'bytes' in opened ? opened.bytes : undefined
    if (!bytes) return { contents: null }
    return bytes.includes(0) ? binary : { contents: new TextDecoder().decode(bytes) }
  })
}

export const GitDiff = Context.Service<{
  computeThreadDiff: (cwd: string, baseCommit?: string) => Effect.Effect<ThreadDiff>
  readDiffFile: (
    cwd: string,
    path: string,
    prevPath?: string,
    baseCommit?: string
  ) => Effect.Effect<DiffFile, StoreError>
  readProjectFile: (cwd: string, path: string) => Effect.Effect<ProjectFile, StoreError>
}>('jetty/GitDiff')

export const GitDiffLive = Layer.effect(
  GitDiff,
  Effect.gen(function* () {
    const services = yield* Effect.context<
      ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
    >()
    return {
      computeThreadDiff: (cwd: string, baseCommit?: string) =>
        computeThreadDiff(cwd, baseCommit).pipe(Effect.provideContext(services)),
      readDiffFile: (cwd: string, path: string, prevPath?: string, baseCommit?: string) =>
        readDiffFile(cwd, path, prevPath, baseCommit).pipe(Effect.provideContext(services)),
      readProjectFile: (cwd: string, path: string) =>
        readProjectFile(cwd, path).pipe(Effect.provideContext(services)),
    }
  })
)
