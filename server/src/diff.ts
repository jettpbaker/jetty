import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { open, realpath, rename, stat, unlink, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'

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

// A branch's own changes start at its merge base, so merging main in doesn't show main's work.
function diffBase(cwd: string, baseCommit?: string) {
  if (!baseCommit) return Effect.succeed(undefined)
  return git(cwd, ['merge-base', baseCommit, 'HEAD']).pipe(
    Effect.map((base) => (base.code === 0 ? base.out.trim() : baseCommit))
  )
}

export function computeThreadDiff(cwd: string, baseCommit?: string) {
  return Effect.gen(function* () {
    const head = yield* git(cwd, ['rev-parse', '--verify', 'HEAD'])
    const base = yield* diffBase(cwd, baseCommit)
    const tracked = yield* git(cwd, [...diffArgs, head.code === 0 ? (base ?? 'HEAD') : EMPTY_TREE])
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
    const before = yield* readHead(root.value, prevPath, yield* diffBase(cwd, baseCommit))
    if (typeof before === 'object' && before) return before
    const after = yield* readWorkingTree(root.value, path)
    if (typeof after === 'object' && after) return after
    return { before, after }
  })
}

export type ProjectFile = { contents: string | null } | Unavailable
export type SavedProjectFile = { saved: true } | { conflict: ProjectFile }

// Paths are relative to the thread's project; symlinks may not lead outside it. `file` is the
// real path, absent when nothing is there.
function resolveProjectPath(cwd: string, path: string) {
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
    if (Option.isSome(file) && !file.value.startsWith(root.value + paths.sep))
      return yield* Effect.fail(new StoreError('invalid_params', `${path} is outside the project`))
    return { root: root.value, file: Option.getOrUndefined(file) }
  })
}

// Opens the real path `file` only while it still is one: no symlink swapped in since it resolved.
async function openResolved(file: string, flags: number) {
  const handle = await open(file, flags | constants.O_NOFOLLOW)
  try {
    const [actual, stats, fromPath] = await Promise.all([realpath(file), handle.stat(), stat(file)])
    if (actual === file && stats.dev === fromPath.dev && stats.ino === fromPath.ino)
      return { handle, stats }
  } catch (error) {
    await handle.close()
    throw error
  }
  await handle.close()
  return undefined
}

type Opened =
  | { file: ProjectFile; text?: never }
  | { file: ProjectFile; text: string; bytes: Buffer }

async function readOpened({
  handle,
  stats,
}: {
  handle: FileHandle
  stats: Stats
}): Promise<Opened> {
  if (!stats.isFile()) return { file: { contents: null } }
  if (stats.size > MAX_CONTENTS_BYTES) return { file: tooLarge }
  const bytes = await handle.readFile()
  if (bytes.includes(0)) return { file: binary }
  // A byte-order mark stays in the text, so saving keeps it.
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  return { file: { contents: text }, text, bytes }
}

// What's at the real path `file` now (contents null: nothing), read only while it still is that
// path; undefined when a symlink was swapped in since it resolved.
async function readCurrent(file: string): Promise<(Opened & { mode?: number }) | undefined> {
  const opened = await openResolved(file, constants.O_RDONLY).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  if (opened === null) return { file: { contents: null } }
  if (!opened) return undefined
  try {
    return { ...(await readOpened(opened)), mode: opened.stats.mode }
  } finally {
    await opened.handle.close()
  }
}

export function readProjectFile(cwd: string, path: string) {
  return Effect.gen(function* () {
    const { file } = yield* resolveProjectPath(cwd, path)
    if (!file) return { contents: null }
    const read = yield* Effect.promise(() =>
      readCurrent(file).catch(() => ({ file: { contents: null } }))
    )
    if (read) return read.file
    return yield* Effect.fail(new StoreError('invalid_params', 'File changed while opening'))
  })
}

// Where a new file at `path` goes: its folder's real path, which must be inside `root`.
async function newFile(root: string, path: string) {
  const target = join(root, path)
  const folder = await realpath(dirname(target)).catch(() => undefined)
  if (!folder || (folder !== root && !folder.startsWith(root + sep)))
    throw new StoreError('not_found', 'Folder not found')
  return join(folder, basename(target))
}

// Writes a synced sibling and renames it over the real path `file`, so a failed save leaves the
// old file whole, and a symlink to it keeps pointing at it.
async function replaceFile(
  file: string,
  bytes: Buffer,
  base: string | null,
  path: string
): Promise<SavedProjectFile | undefined> {
  const current = await readCurrent(file)
  if (!current) return undefined
  const holds =
    base === null
      ? 'contents' in current.file && current.file.contents === null
      : current.text === base
  if (!holds) return { conflict: current.file }
  // The text came from decoding these bytes; saving would rewrite any that weren't UTF-8.
  if (current.text !== undefined && !current.bytes.equals(Buffer.from(current.text)))
    throw new StoreError('invalid_params', `${path} isn't UTF-8 text`)
  const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.jetty-save`)
  const handle = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o666
  )
  let renamed = false
  try {
    try {
      // Node can't create relative to the folder it checked, so resolving the sibling again is
      // what shows it went there, not through a symlink swapped in since. The rename finds it
      // through the same path, so it can only land beside it.
      if ((await realpath(temp).catch(() => undefined)) !== temp) return undefined
      await handle.writeFile(bytes)
      if (current.mode !== undefined) await handle.chmod(current.mode & 0o7777)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, file)
    renamed = true
  } finally {
    if (!renamed) await unlink(temp).catch(() => {})
  }
  return { saved: true }
}

// Saves only while the file still holds `base`, the text the edit started from (null: no file);
// otherwise nothing is written and the conflict carries what's there now.
export function writeProjectFile(cwd: string, path: string, contents: string, base: string | null) {
  return Effect.gen(function* () {
    const bytes = Buffer.from(contents)
    if (bytes.length > MAX_CONTENTS_BYTES)
      return yield* Effect.fail(new StoreError('invalid_params', 'File too large to save'))
    const { root, file } = yield* resolveProjectPath(cwd, path)
    if (!file && base !== null) return { conflict: { contents: null } }
    const saved = yield* Effect.tryPromise({
      try: async () => replaceFile(file ?? (await newFile(root, path)), bytes, base, path),
      catch: (error) =>
        error instanceof StoreError
          ? error
          : new StoreError('internal', `Couldn't save ${path}`, { cause: error }),
    })
    if (saved) return saved
    return yield* Effect.fail(new StoreError('conflict', 'File changed while saving'))
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
  writeProjectFile: (
    cwd: string,
    path: string,
    contents: string,
    base: string | null
  ) => Effect.Effect<SavedProjectFile, StoreError>
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
      writeProjectFile: (cwd: string, path: string, contents: string, base: string | null) =>
        writeProjectFile(cwd, path, contents, base).pipe(Effect.provideContext(services)),
    }
  })
)
