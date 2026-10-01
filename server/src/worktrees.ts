import type { ThreadMeta } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { spawn, type ChildProcess } from 'node:child_process'
import { cp, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path'

import type { Store, WorktreeRecord } from './store'

import { StoreError } from './store'

export type Worktrees = ReturnType<typeof createWorktrees>

async function command(cwd: string, args: string[], timeout = 120_000) {
  const process = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => process.kill(), timeout)
  try {
    const [out, error, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    if (code !== 0) throw new Error(error.trim() || `${args[0]} exited ${code}`)
    return args.includes('-z') ? out : out.trim()
  } finally {
    clearTimeout(timer)
  }
}

function validRef(name: string) {
  if (!name || name.startsWith('-') || name.includes('\0'))
    throw new StoreError('invalid_params', 'Invalid git ref')
  return name
}

export function branchSlug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)
      .replace(/^-|-$/g, '') || 'thread'
  )
}

export function createWorktrees(
  store: Store,
  home: string,
  onChange: (thread: ThreadMeta) => void
) {
  let closing = false
  const locks = new Map<string, Promise<unknown>>()
  const setupProcesses = new Set<ChildProcess>()
  const preparations = new Map<string, Promise<string>>()

  function runSetup(
    script: string,
    cwd: string,
    env: Record<string, string>,
    signal?: AbortSignal
  ) {
    if (closing) throw new Error('Worktree setup interrupted by shutdown')
    signal?.throwIfAborted()
    return new Promise<void>((resolve, reject) => {
      const child = spawn('sh', ['-lc', script], {
        cwd,
        env: { ...process.env, ...env },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      setupProcesses.add(child)
      function abort() {
        killSetup(child)
      }
      signal?.addEventListener('abort', abort, { once: true })
      let output = ''
      let timedOut = false
      function capture(chunk: Buffer) {
        output = (output + chunk.toString()).slice(-64 * 1024)
      }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      const timer = setTimeout(() => {
        timedOut = true
        killSetup(child)
      }, 15 * 60_000)
      function finish(error?: Error) {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        setupProcesses.delete(child)
        if (error) reject(error)
        else resolve()
      }
      child.once('error', finish)
      child.once('close', (code) =>
        finish(
          code === 0
            ? undefined
            : new Error(
                timedOut
                  ? 'Worktree setup timed out after 15 minutes'
                  : `Worktree setup failed: ${output.trim() || `exit ${code}`}`
              )
        )
      )
    })
  }

  function killSetup(child: ChildProcess) {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }

  async function shutdown() {
    closing = true
    for (const child of setupProcesses) killSetup(child)
    await Promise.allSettled(preparations.values())
  }

  async function refresh(threadId: string) {
    const folder = await root(threadId)
    const branch = await command(folder, ['git', 'branch', '--show-current']).catch(() => '')
    if (branch) {
      const status = await command(folder, [
        'git',
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '-z',
      ])
      await Effect.runPromise(store.setThreadGit(threadId, { branch, dirty: Boolean(status) }))
    }
    onChange(await Effect.runPromise(store.requireThread(threadId)))
  }

  async function reconcile() {
    for (const { threadId, record } of await Effect.runPromise(store.listWorktrees())) {
      if (record.state === 'setting_up') {
        record.state = 'failed'
        record.error = 'Worktree setup interrupted by server restart'
        await save(threadId, record)
      }
      if (record.state === 'failed') await Effect.runPromise(store.setQueuePaused(threadId, true))
    }
  }

  async function serialized<A>(cwd: string, action: () => Promise<A>): Promise<A> {
    const common = await realpath(
      await command(cwd, ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    )
    const prior = locks.get(common) ?? Promise.resolve()
    const pending = prior.catch(() => {}).then(action)
    locks.set(common, pending)
    try {
      return await pending
    } finally {
      if (locks.get(common) === pending) locks.delete(common)
    }
  }

  async function defaultRef(cwd: string) {
    let branch = await command(cwd, [
      'git',
      'symbolic-ref',
      '--quiet',
      'refs/remotes/origin/HEAD',
    ]).catch(() => '')
    if (!branch) {
      const remote = await command(cwd, ['git', 'ls-remote', '--symref', 'origin', 'HEAD']).catch(
        () => ''
      )
      branch = remote.match(/ref: refs\/heads\/(\S+)\s+HEAD/)?.[1] ?? ''
    }
    if (branch) return branch.startsWith('refs/remotes/') ? branch.slice(13) : `origin/${branch}`
    for (const name of ['main', 'master']) {
      const exists = await command(cwd, [
        'git',
        'ls-remote',
        '--heads',
        'origin',
        `refs/heads/${name}`,
      ]).catch(() => '')
      if (exists) return `origin/${name}`
    }
    throw new Error('No default branch on origin (main or master)')
  }

  async function resolveRef(cwd: string, name?: string) {
    const ref = validRef(name ?? (await defaultRef(cwd)))
    if (ref.startsWith('origin/')) {
      const branch = validRef(ref.slice(7))
      await command(cwd, ['git', 'check-ref-format', `refs/heads/${branch}`]).catch(() => {
        throw new Error(`No branch ${ref} locally or on origin`)
      })
      await command(cwd, [
        'git',
        'fetch',
        'origin',
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ]).catch(() => {
        throw new Error(`No branch ${ref} locally or on origin`)
      })
    }
    const local = await command(cwd, [
      'git',
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${ref.startsWith('origin/') ? `refs/remotes/${ref}` : ref}^{commit}`,
    ]).catch(() => '')
    if (local) return local
    await command(cwd, ['git', 'check-ref-format', `refs/heads/${ref}`]).catch(() => {
      throw new Error(`No branch ${ref} locally or on origin`)
    })
    await command(cwd, [
      'git',
      'fetch',
      'origin',
      `+refs/heads/${ref}:refs/remotes/origin/${ref}`,
    ]).catch(() => {
      throw new Error(`No branch ${ref} locally or on origin`)
    })
    return command(cwd, [
      'git',
      'rev-parse',
      '--verify',
      '--end-of-options',
      `origin/${ref}^{commit}`,
    ])
  }

  async function branches(cwd: string, query = '', localOnly = false) {
    return serialized(cwd, async () => {
      const currentBranch = await command(cwd, ['git', 'branch', '--show-current'])
      const base = localOnly ? currentBranch : await defaultRef(cwd)
      if (!localOnly) await resolveRef(cwd, base)
      if (!localOnly && query.trim()) await command(cwd, ['git', 'fetch', 'origin', '--prune'])
      const local = await command(cwd, [
        'git',
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname:short)',
        'refs/heads',
      ])
      const remote =
        !localOnly && query.trim()
          ? await command(cwd, [
              'git',
              'for-each-ref',
              '--sort=-committerdate',
              '--format=%(refname:short)',
              'refs/remotes/origin',
            ])
          : ''
      const refs = [...new Set([base, ...local.split('\n'), ...remote.split('\n')])].filter(
        (ref) => ref && ref !== 'origin/HEAD'
      )
      return {
        defaultRef: base,
        currentBranch,
        branches: refs.filter(
          (ref) => ref === base || ref.toLowerCase().includes(query.toLowerCase())
        ),
      }
    })
  }

  async function project(threadId: string) {
    const thread = await Effect.runPromise(store.requireThread(threadId))
    const project = await Effect.runPromise(store.getProject(thread.projectId))
    if (!project) throw new Error('Project not found')
    return { thread, project }
  }

  function path(projectId: string, threadId: string) {
    for (const id of [projectId, threadId]) {
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid worktree id')
    }
    return join(home, 'worktrees', projectId, threadId)
  }

  async function save(threadId: string, record: WorktreeRecord) {
    await Effect.runPromise(store.saveWorktree(threadId, record))
    await refresh(threadId)
  }

  async function root(threadId: string) {
    const { thread, project: source } = await project(threadId)
    return thread.environment === 'worktree' ? path(source.id, threadId) : source.path
  }

  async function copyIncluded(source: string, target: string) {
    const patterns = await readFile(join(source, '.worktreeinclude'), 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return ''
        throw error
      }
    )
    if (!patterns) return
    const ignored = await command(source, [
      'git',
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z',
    ])
    const matcher = join(target, '.git-worktreeinclude')
    await Bun.write(matcher, patterns)
    try {
      const candidates = ignored.split('\0').filter(Boolean)
      const input = Bun.spawn(
        ['git', 'ls-files', '--others', '--ignored', '--exclude-from=' + matcher, '-z'],
        { cwd: source, stdout: 'pipe', stderr: 'pipe' }
      )
      const matches = new Set((await new Response(input.stdout).text()).split('\0').filter(Boolean))
      await input.exited
      const sourceRoot = await realpath(source)
      const targetRoot = await realpath(target)
      for (const file of candidates) {
        if (!matches.has(file)) continue
        const origin = join(source, file)
        const info = await lstat(origin)
        if (!info.isFile()) continue
        const rel = relative(sourceRoot, await realpath(origin))
        if (rel.startsWith('..') || isAbsolute(rel)) continue
        const destination = resolve(target, file)
        if (!destination.startsWith(resolve(target) + '/')) continue
        let ancestor = dirname(destination)
        let parent: string | undefined
        while (!parent) {
          parent = await realpath(ancestor).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error
            return undefined
          })
          if (!parent) ancestor = dirname(ancestor)
        }
        const targetRelative = relative(targetRoot, parent)
        if (
          targetRelative === '..' ||
          targetRelative.startsWith('../') ||
          isAbsolute(targetRelative)
        )
          throw new Error(`Included file ${file} points outside the worktree`)
        const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
          return null
        })
        if (existing?.isSymbolicLink())
          throw new Error(`Included file ${file} would overwrite a symlink`)
        await mkdir(dirname(destination), { recursive: true })
        await cp(origin, destination, { force: true })
      }
    } finally {
      await rm(matcher, { force: true })
    }
  }

  async function prepareNow(threadId: string, signal?: AbortSignal) {
    const { thread, project: source } = await project(threadId)
    if (thread.environment !== 'worktree') {
      const head = await command(source.path, ['git', 'rev-parse', '--verify', 'HEAD']).catch(
        () => ''
      )
      if (head) await Effect.runPromise(store.captureLocalBase(threadId, head))
      await refresh(threadId)
      return source.path
    }
    const folder = path(source.id, threadId)
    let record = await Effect.runPromise(store.getWorktree(threadId))
    if (!record) throw new Error('Worktree has no base ref')
    await serialized(source.path, async () => {
      record = (await Effect.runPromise(store.getWorktree(threadId)))!
      if (await Bun.file(join(folder, '.git')).exists()) {
        if (record.slot === null || record.checkoutPath === null) {
          record.slot = await Effect.runPromise(store.allocateWorktreeSlot(threadId))
          record.checkoutPath = folder
          record.state = 'pending'
          await save(threadId, record)
        }
        return
      }
      await command(source.path, ['git', 'worktree', 'prune'])
      await mkdir(dirname(folder), { recursive: true })
      if (!record.baseCommit) {
        record.baseCommit = await resolveRef(source.path, record.ref)
        record.prefix = await Effect.runPromise(store.getBranchPrefix())
        const temporary = `${record.prefix}/thread-${threadId}`
        record.branch = temporary
        record.temporaryBranch = temporary
        await save(threadId, record)
        await command(source.path, [
          'git',
          'worktree',
          'add',
          '-b',
          temporary,
          '--',
          folder,
          record.baseCommit,
        ])
      } else {
        const exists = await command(source.path, [
          'git',
          'show-ref',
          '--verify',
          `refs/heads/${record.branch}`,
        ]).catch(() => '')
        if (!exists && record.checkoutPath)
          throw new Error(`Worktree branch ${record.branch} is missing`)
        await command(source.path, [
          'git',
          'worktree',
          'add',
          ...(exists ? [] : ['-b', record.branch!]),
          '--',
          folder,
          exists ? record.branch! : record.baseCommit,
        ])
      }
      record.slot = await Effect.runPromise(store.allocateWorktreeSlot(threadId))
      record.checkoutPath = folder
      record.state = 'pending'
      record.error = null
      await save(threadId, record)
    })
    if (record.state === 'ready') {
      if (record.temporaryBranch && thread.title !== 'New thread')
        await rename(threadId, thread.title).catch(() => {})
      await refresh(threadId)
      return folder
    }
    record.state = 'setting_up'
    record.error = null
    await save(threadId, record)
    try {
      await copyIncluded(source.path, folder)
      const recipe = await readFile(join(folder, '.jetty/worktree.json'), 'utf8').catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return '{}'
          throw error
        }
      )
      const config: unknown = JSON.parse(recipe)
      if (
        !config ||
        typeof config !== 'object' ||
        ('setup' in config && typeof config.setup !== 'string')
      )
        throw new Error('Invalid .jetty/worktree.json')
      if ('setup' in config && typeof config.setup === 'string' && config.setup.trim()) {
        await runSetup(
          config.setup,
          folder,
          {
            JETTY_WORKTREE_NAME: basename(folder),
            JETTY_WORKTREE_SLOT: String(record.slot),
          },
          signal
        )
      }
      record.state = 'ready'
      await save(threadId, record)
    } catch (error) {
      record.state = 'failed'
      record.error = error instanceof Error ? error.message : String(error)
      await save(threadId, record)
      throw error
    }
    if (record.temporaryBranch && thread.title !== 'New thread')
      await rename(threadId, thread.title).catch(() => {})
    return folder
  }

  function prepare(threadId: string, signal?: AbortSignal) {
    if (closing) return Promise.reject(new StoreError('conflict', 'Server is shutting down'))
    const existing = preparations.get(threadId)
    if (existing) return existing
    const pending = prepareNow(threadId, signal)
      .catch(async (error: unknown) => {
        const record = await Effect.runPromise(store.getWorktree(threadId))
        if (record && record.state !== 'failed') {
          record.state = 'failed'
          record.error = error instanceof Error ? error.message : String(error)
          await save(threadId, record)
        }
        if (record) {
          await Effect.runPromise(store.setQueuePaused(threadId, true))
          await refresh(threadId)
        }
        throw error
      })
      .finally(() => preparations.delete(threadId))
    preparations.set(threadId, pending)
    return pending
  }

  async function dirty(threadId: string) {
    const folder = await root(threadId)
    if (
      !(await Bun.file(join(folder, '.git')).exists()) &&
      (await project(threadId)).thread.environment === 'worktree'
    )
      return 0
    const status = await command(folder, [
      'git',
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '-z',
    ])
    const entries = status.split('\0').filter(Boolean)
    let count = 0
    for (let i = 0; i < entries.length; i++) {
      count++
      if (/^[RC]|^.[RC]/.test(entries[i]!)) i++
    }
    return count
  }

  async function remove(threadId: string, deleting = false) {
    const { thread, project: source } = await project(threadId)
    if (thread.environment !== 'worktree') return
    if (preparations.has(threadId)) throw new StoreError('conflict', 'Worktree setup is running')
    await serialized(source.path, async () => {
      const record = await Effect.runPromise(store.getWorktree(threadId))
      if (!record) return
      const folder = path(source.id, threadId)
      if (!deleting && (await dirty(threadId)))
        throw new StoreError(
          'conflict',
          'Commit or discard uncommitted changes before archiving this worktree'
        )
      if (await Bun.file(join(folder, '.git')).exists())
        await command(source.path, [
          'git',
          'worktree',
          'remove',
          ...(deleting ? ['--force'] : []),
          '--',
          folder,
        ])
      await command(source.path, ['git', 'worktree', 'prune'])
      if (deleting && thread.pullRequests?.some((link) => link.state === 'merged') && record.branch)
        await command(source.path, ['git', 'branch', '-D', '--', record.branch])
      record.slot = null
      record.state = 'pending'
      await save(threadId, record)
    })
  }

  async function rename(threadId: string, title: string) {
    const { thread, project: source } = await project(threadId)
    if (thread.environment !== 'worktree') return
    await serialized(source.path, async () => {
      const record = await Effect.runPromise(store.getWorktree(threadId))
      if (!record?.temporaryBranch || record.branch !== record.temporaryBranch) return
      const folder = path(source.id, threadId)
      const current = await command(folder, ['git', 'branch', '--show-current'])
      const upstream = await command(folder, [
        'git',
        'for-each-ref',
        '--format=%(upstream)',
        `refs/heads/${current}`,
      ])
      const remote = await command(source.path, [
        'git',
        'ls-remote',
        '--heads',
        'origin',
        `refs/heads/${current}`,
      ])
      if (current !== record.temporaryBranch || upstream || remote) {
        record.temporaryBranch = null
        await save(threadId, record)
        return
      }
      const refs = await command(source.path, [
        'git',
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads',
        'refs/remotes',
      ])
      const remoteRefs = await command(source.path, ['git', 'ls-remote', '--heads', 'origin'])
      const occupied = new Set([
        ...refs.split('\n').map((ref) => ref.replace(/^refs\/heads\/|^refs\/remotes\/[^/]+\//, '')),
        ...remoteRefs.split('\n').map((line) => line.split('\t')[1]?.replace('refs/heads/', '')),
      ])
      const base = `${record.prefix}/${branchSlug(title)}`
      let next = base
      let suffix = 2
      while (occupied.has(next)) next = `${base}-${suffix++}`
      await command(folder, ['git', 'branch', '-m', '--', next])
      record.branch = next
      record.temporaryBranch = null
      await save(threadId, record)
    })
  }

  return {
    branches,
    defaultRef,
    resolveRef: (cwd: string, ref?: string) => serialized(cwd, () => resolveRef(cwd, ref)),
    root,
    prepare,
    dirty,
    remove,
    rename,
    refresh,
    shutdown,
    reconcile,
  }
}
