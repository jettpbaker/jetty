import type { Checkpoint } from '@jetty/shared/events'

import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { git, gitOutput, isFolder, type Worktrees } from './worktrees'

const author = {
  GIT_AUTHOR_NAME: 'Jetty',
  GIT_AUTHOR_EMAIL: 'jetty@localhost',
  GIT_COMMITTER_NAME: 'Jetty',
  GIT_COMMITTER_EMAIL: 'jetty@localhost',
}

function refPrefix(threadId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(threadId)) throw new Error('Invalid thread id')
  return `refs/jetty/checkpoints/${threadId}/turn/`
}

const tryRev = (cwd: string, ref: string) =>
  git(cwd, 'rev-parse', '--verify', '--quiet', ref).catch(() => '')

async function repository(folder: string) {
  if (!(await isFolder(folder))) return undefined
  return git(folder, 'rev-parse', '--show-toplevel').catch(() => undefined)
}

// Commits the working tree (tracked + untracked, gitignored excluded) through a temporary
// index so the user's index is never touched. Parentless, so HEAD never moves.
async function snapshot(cwd: string, message: string) {
  const gitDir = await git(cwd, 'rev-parse', '--path-format=absolute', '--git-dir')
  const temp = await mkdtemp(join(gitDir, 'jetty-checkpoint-'))
  const index = join(temp, 'index')
  const run = async (...args: string[]) =>
    (await gitOutput(cwd, args, { ...author, GIT_INDEX_FILE: index })).trim()
  try {
    const real = await git(cwd, 'rev-parse', '--path-format=absolute', '--git-path', 'index')
    await copyFile(real, index).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    if (await tryRev(cwd, 'HEAD'))
      await run('read-tree', '--reset', 'HEAD').catch(() => run('read-tree', 'HEAD'))
    else await run('read-tree', '--empty')
    await run('add', '-A', '--', '.')
    return await run('commit-tree', await run('write-tree'), '-m', message)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function changedFiles(cwd: string, from: string, to: string) {
  const out = await gitOutput(cwd, ['diff', '--numstat', '-z', '--no-renames', from, to])
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...path] = line.split('\t')
      return { path: path.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0 }
    })
}

export function createCheckpoints(worktrees: Worktrees) {
  const folder = async (threadId: string) => repository(await worktrees.root(threadId))

  async function capture(threadId: string, number: number): Promise<Checkpoint | undefined> {
    const cwd = await folder(threadId)
    if (!cwd) return
    return worktrees.serialized(cwd, async () => {
      const ref = `${refPrefix(threadId)}${number}`
      const existing = number === 0 ? await tryRev(cwd, ref) : ''
      const oid = existing || (await snapshot(cwd, `jetty checkpoint ${threadId} turn ${number}`))
      if (!existing) await git(cwd, 'update-ref', ref, oid)
      const previous = number > 0 ? await tryRev(cwd, `${refPrefix(threadId)}${number - 1}`) : ''
      return { number, oid, files: previous ? await changedFiles(cwd, previous, oid) : [] }
    })
  }

  async function verify(threadId: string, oid: string) {
    const cwd = await folder(threadId)
    if (!cwd || (await git(cwd, 'cat-file', '-t', oid).catch(() => '')) !== 'commit')
      throw new Error('Checkpoint is unavailable')
  }

  async function restore(threadId: string, oid: string) {
    const cwd = await folder(threadId)
    if (!cwd) throw new Error('Checkpoint folder is unavailable')
    await worktrees.serialized(cwd, async () => {
      // `restore` rejects a pathspec that matches nothing, which an empty tree would.
      if (await git(cwd, 'ls-files', '--cached', `--with-tree=${oid}`, '--', '.'))
        await git(cwd, 'restore', '--source', oid, '--worktree', '--staged', '--', '.')
      await git(cwd, 'clean', '-fd', '--', '.')
      if (await tryRev(cwd, 'HEAD')) await git(cwd, 'reset', '--quiet', '--', '.')
    })
  }

  // Refs are shared by the project checkout and its worktrees, so they outlive a removed worktree.
  async function remove(threadId: string, after = -1) {
    const prefix = refPrefix(threadId)
    const cwd = await repository(await worktrees.projectRoot(threadId))
    if (!cwd) return
    await worktrees.serialized(cwd, async () => {
      const refs = await git(cwd, 'for-each-ref', '--format=%(refname)', prefix)
      for (const ref of refs.split('\n'))
        if (ref && Number(ref.slice(prefix.length)) > after) await git(cwd, 'update-ref', '-d', ref)
    })
  }

  return { capture, verify, restore, remove }
}
