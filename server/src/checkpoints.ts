import type { Checkpoint } from '@jetty/shared/events'

import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { git, gitOutput, isFolder, type Worktrees } from './worktrees'

function prefix(threadId: string) {
  const id = /^[a-zA-Z0-9_-]+$/.test(threadId) ? threadId : Buffer.from(threadId).toString('hex')
  return `refs/jetty/checkpoints/${id}/turn/`
}

async function repository(cwd: string) {
  if (!(await isFolder(cwd))) return undefined
  return git(cwd, 'rev-parse', '--show-toplevel').catch(() => undefined)
}

export function createCheckpoints(worktrees: Worktrees) {
  async function capture(threadId: string, number: number): Promise<Checkpoint | undefined> {
    const cwd = await repository(await worktrees.root(threadId))
    if (!cwd) return
    return worktrees.serialized(cwd, async () => {
      const ref = `${prefix(threadId)}${number}`
      const existing = await git(cwd, 'rev-parse', '--verify', ref).catch(() => '')
      if (existing && number === 0)
        return { number, oid: existing, files: await files(cwd, threadId, number, existing) }
      const dir = await git(cwd, 'rev-parse', '--path-format=absolute', '--git-dir')
      const temp = await mkdtemp(join(dir, 'jetty-checkpoint-'))
      const index = join(temp, 'index')
      const env = {
        GIT_INDEX_FILE: index,
        GIT_AUTHOR_NAME: 'Jetty',
        GIT_AUTHOR_EMAIL: 'jetty@localhost',
        GIT_COMMITTER_NAME: 'Jetty',
        GIT_COMMITTER_EMAIL: 'jetty@localhost',
      }
      const run = async (...args: string[]) => (await gitOutput(cwd, args, env)).trim()
      try {
        const realIndex = await git(
          cwd,
          'rev-parse',
          '--path-format=absolute',
          '--git-path',
          'index'
        )
        await copyFile(realIndex, index).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
        const head = await git(cwd, 'rev-parse', '--verify', 'HEAD').catch(() => '')
        if (head) await run('read-tree', '--reset', 'HEAD').catch(() => run('read-tree', 'HEAD'))
        else await run('read-tree', '--empty')
        await run('add', '-A', '--', '.')
        const tree = await run('write-tree')
        const oid = await run(
          'commit-tree',
          tree,
          '-m',
          `jetty checkpoint ${threadId} turn ${number}`
        )
        await git(cwd, 'update-ref', ref, oid)
        return { number, oid, files: await files(cwd, threadId, number, oid) }
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
    })
  }

  async function files(cwd: string, threadId: string, number: number, oid: string) {
    if (number === 0) return []
    const previous = await git(
      cwd,
      'rev-parse',
      '--verify',
      `${prefix(threadId)}${number - 1}`
    ).catch(() => '')
    if (!previous) return []
    const diff = await gitOutput(cwd, [
      'diff',
      '--numstat',
      '-z',
      '--no-renames',
      previous,
      oid,
      '--',
      '.',
    ])
    return diff
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const [added, deleted, ...path] = line.split('\t')
        return { path: path.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0 }
      })
  }

  async function restore(threadId: string, oid: string) {
    const cwd = await repository(await worktrees.root(threadId))
    if (!cwd) throw new Error('Checkpoint folder is unavailable')
    await worktrees.serialized(cwd, async () => {
      const tracked = await git(cwd, 'ls-files', '--cached', `--with-tree=${oid}`, '-z', '--', '.')
      if (tracked) await git(cwd, 'restore', '--source', oid, '--worktree', '--staged', '--', '.')
      await git(cwd, 'clean', '-fd', '--', '.')
      if (await git(cwd, 'rev-parse', '--verify', 'HEAD').catch(() => ''))
        await git(cwd, 'reset', '--quiet', '--', '.')
    })
  }

  async function requireCheckpoint(threadId: string, number: number, oid: string) {
    const cwd = await repository(await worktrees.root(threadId))
    if (
      !cwd ||
      (await git(cwd, 'rev-parse', '--verify', `${prefix(threadId)}${number}`).catch(() => '')) !==
        oid
    )
      throw new Error('Checkpoint is unavailable')
  }

  async function remove(threadId: string, after = -1) {
    const cwd = await repository(await worktrees.root(threadId))
    // Archived worktrees no longer have a working folder; refs still live in the project repo.
    const repo = cwd ?? (await repository(await worktrees.projectRoot(threadId)))
    if (!repo) return
    await worktrees.serialized(repo, async () => {
      const refs = await git(repo, 'for-each-ref', '--format=%(refname)', prefix(threadId))
      for (const ref of refs.split('\n'))
        if (ref && Number(ref.slice(prefix(threadId).length)) > after)
          await git(repo, 'update-ref', '-d', ref)
    })
  }

  return { capture, restore, requireCheckpoint, remove }
}
