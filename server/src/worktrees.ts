import type { Branch, ThreadMeta } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { spawn, type ChildProcess } from 'node:child_process'
import { cp, lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import type { Store, WorktreeRecord } from './store'

import { DEFAULT_THREAD_TITLE, StoreError } from './store'

export type Worktrees = ReturnType<typeof createWorktrees>

const SETUP_TIMEOUT = 15 * 60_000
const CONFIG = '.jetty/worktree.json'
// Shipped with Jetty; an agent reads it by absolute path to write a project's worktree config.
const setupGuide = resolve(import.meta.dir, '../../docs/worktree-setup.md')

export const isFolder = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false
  )

function spawnGit(cwd: string, args: string[]) {
  try {
    return Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  } catch (error) {
    // Bun reports a missing cwd as the git binary itself missing.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Project folder not found: ${cwd}`)
    throw error
  }
}

async function git(cwd: string, ...args: string[]) {
  const process = spawnGit(cwd, args)
  const timer = setTimeout(() => process.kill(), 120_000)
  try {
    const [out, error, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    if (code !== 0) throw new Error(error.trim() || `git ${args[0]} exited ${code}`)
    return out.trim()
  } finally {
    clearTimeout(timer)
  }
}

const tryGit = (cwd: string, ...args: string[]) => git(cwd, ...args).catch(() => '')

type GitState = 'ok' | 'missing' | 'not-git'

async function gitState(path: string): Promise<GitState> {
  if (!(await isFolder(path))) return 'missing'
  return (await tryGit(path, 'rev-parse', '--is-inside-work-tree')) === 'true' ? 'ok' : 'not-git'
}

async function requireGit(path: string) {
  const state = await gitState(path)
  if (state === 'missing')
    throw new StoreError('invalid_params', `Project folder not found: ${path}`)
  if (state === 'not-git')
    throw new StoreError('invalid_params', `${basename(path)} isn't a git repository`)
}

function validRef(name: string) {
  if (!name || name.startsWith('-') || name.includes('\0'))
    throw new StoreError('invalid_params', 'Invalid git ref')
  return name
}

function branchSlug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)
      .replace(/^-|-$/g, '') || 'thread'
  )
}

function readJson(path: string) {
  return readFile(path, 'utf8').then(
    (text) => JSON.parse(text) as unknown,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
  )
}

type WorktreeScript = 'setup' | 'archive'

// Read from the project checkout, never a worktree: the agent can edit the worktree's copy.
async function worktreeConfig(root: string) {
  const config = await readJson(join(root, CONFIG))
  if (config === undefined) return {}
  const invalid = () => new Error(`Invalid ${CONFIG}`)
  if (!config || typeof config !== 'object') throw invalid()
  const fields = config as Partial<Record<WorktreeScript | 'environment', unknown>>
  function script(key: WorktreeScript) {
    const value = fields[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw invalid()
    return value.trim() || undefined
  }
  const environment: ThreadMeta['environment'] | undefined =
    fields.environment === 'local' || fields.environment === 'worktree'
      ? fields.environment
      : undefined
  if (fields.environment !== undefined && !environment) throw invalid()
  return { setup: script('setup'), archive: script('archive'), environment }
}

// Runs a worktree script ($1) so its process group dies with the server, however the server exits:
// a watcher waits on the server's end of stdin, which only closes then.
const supervised =
  'exec 3<&0; (read -r _ <&3; kill -KILL 0) & sh -lc "$1" </dev/null 3<&-; code=$?; kill $!; exit $code'

// Without a .worktreeinclude, env files are what a fresh worktree most often lacks.
const defaultIncludes = ['--exclude=.env*', '--exclude=!**/node_modules/**']
const dirtyArchive = 'Commit or discard uncommitted changes before archiving this worktree'
const detachedArchive =
  "Put the commits on this worktree's detached HEAD on a branch before archiving it"

export function createWorktrees(
  store: Store,
  home: string,
  onChange: (thread: ThreadMeta) => void
) {
  let closing = false
  const locks = new Map<string, Promise<unknown>>()
  const setups = new Set<ChildProcess>()
  const preparations = new Map<string, { pending: Promise<string>; stop: AbortController }>()
  const run = <A>(effect: Effect.Effect<A, StoreError>) => Effect.runPromise(effect)

  // One git mutation at a time per repository, shared by its main checkout and worktrees.
  async function serialized<A>(cwd: string, action: () => Promise<A>) {
    const repo = await realpath(
      await git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    )
    const pending = (locks.get(repo) ?? Promise.resolve()).catch(() => {}).then(action)
    locks.set(repo, pending)
    try {
      return await pending
    } finally {
      if (locks.get(repo) === pending) locks.delete(repo)
    }
  }

  const hasOrigin = async (cwd: string) => Boolean(await tryGit(cwd, 'remote', 'get-url', 'origin'))

  // A repo without origin starts worktrees from its current checkout.
  async function defaultRef(cwd: string) {
    if (!(await hasOrigin(cwd))) return (await git(cwd, 'branch', '--show-current')) || 'HEAD'
    const head = await tryGit(cwd, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD')
    if (head) return head.replace(/^refs\/remotes\//, '')
    const remote = await tryGit(cwd, 'ls-remote', '--symref', 'origin', 'HEAD')
    const branch = remote.match(/ref: refs\/heads\/(\S+)\s+HEAD/)?.[1]
    if (branch) return `origin/${branch}`
    for (const name of ['main', 'master'])
      if (await tryGit(cwd, 'ls-remote', '--heads', 'origin', `refs/heads/${name}`))
        return `origin/${name}`
    throw new Error('No default branch on origin (main or master); pass ref')
  }

  async function fetchBranch(cwd: string, branch: string, ref: string) {
    const missing = () => {
      throw new Error(`No branch ${ref} locally or on origin`)
    }
    await git(cwd, 'check-ref-format', `refs/heads/${branch}`).catch(missing)
    await git(cwd, 'fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`).catch(
      missing
    )
  }

  function revParse(cwd: string, ref: string) {
    return tryGit(cwd, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)
  }

  // A local branch, tag or commit wins; otherwise the branch is fetched from origin.
  // origin/* refs are always fetched first so they are fresh.
  async function resolveRef(cwd: string, name?: string) {
    const ref = validRef(name ?? (await defaultRef(cwd)))
    const remote = ref.startsWith('origin/') ? ref.slice(7) : ''
    if (remote) await fetchBranch(cwd, remote, ref)
    const local = await revParse(cwd, remote ? `refs/remotes/${ref}` : ref)
    if (local) return local
    if (remote) throw new Error(`No branch ${ref} locally or on origin`)
    await fetchBranch(cwd, ref, ref)
    return git(
      cwd,
      'rev-parse',
      '--verify',
      '--end-of-options',
      `refs/remotes/origin/${ref}^{commit}`
    )
  }

  // Branches checked out in any of Jetty's worktrees of this repository.
  async function worktreeBranches(cwd: string) {
    const root = await realpath(join(home, 'worktrees')).catch(() => undefined)
    const names = new Set<string>()
    if (!root) return names
    for (const entry of (await git(cwd, 'worktree', 'list', '--porcelain')).split('\n\n')) {
      const path = entry.match(/^worktree (.+)$/m)?.[1]
      const branch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1]
      if (path && branch && (await realpath(path).catch(() => path)).startsWith(`${root}/`))
        names.add(branch)
    }
    return names
  }

  async function branches(cwd: string, localOnly = false) {
    const state = await gitState(cwd)
    if (state !== 'ok') return { git: state }
    // Reads never queue behind another request's fetch; only the fetch itself is serialized.
    const currentBranch = await git(cwd, 'branch', '--show-current')
    const remote = !localOnly && (await hasOrigin(cwd))
    const base = localOnly ? currentBranch : await defaultRef(cwd)
    if (remote) await serialized(cwd, () => git(cwd, 'fetch', 'origin', '--prune'))
    const checkedOut = localOnly ? new Set<string>() : await worktreeBranches(cwd)
    const refs = await git(
      cwd,
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)',
      'refs/heads',
      ...(remote ? ['refs/remotes/origin'] : [])
    )
    const byName = new Map<string, Branch>()
    for (const ref of refs.split('\n')) {
      const origin = ref.startsWith('refs/remotes/origin/')
      const name = ref.replace(/^refs\/(heads|remotes\/origin)\//, '')
      if (!name || (origin && name === 'HEAD')) continue
      const known = byName.get(name)
      byName.set(name, {
        name,
        local: !origin || Boolean(known?.local),
        origin: origin || Boolean(known?.origin),
        worktree: checkedOut.has(name),
      })
    }
    const top = await git(cwd, 'rev-parse', '--show-toplevel')
    // A broken config only loses the default here; setup reports it.
    const config = await worktreeConfig(top).catch(() => undefined)
    const configured = await Bun.file(join(top, CONFIG)).exists()
    return {
      git: state,
      defaultRef: base,
      currentBranch,
      branches: [...byName.values()],
      defaultEnvironment: config?.environment,
      ...(configured ? {} : { setupGuide }),
    }
  }

  // A new thread's environment unless the user picked one; a folder git can't use works in place.
  async function defaultEnvironment(path: string): Promise<ThreadMeta['environment']> {
    if ((await gitState(path)) !== 'ok') return 'local'
    const top = await git(path, 'rev-parse', '--show-toplevel')
    return (await worktreeConfig(top).catch(() => undefined))?.environment ?? 'worktree'
  }

  async function locate(threadId: string) {
    const thread = await run(store.requireThread(threadId))
    const project = await run(store.getProject(thread.projectId))
    if (!project) throw new Error('Project not found')
    return { thread, project }
  }

  function folderOf(projectId: string, threadId: string) {
    for (const id of [projectId, threadId])
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid worktree id')
    return join(home, 'worktrees', projectId, threadId)
  }

  const exists = (folder: string) => Bun.file(join(folder, '.git')).exists()

  // A worktree checks out the whole repository; a project nested inside it works in its subfolder.
  async function workingFolder(projectPath: string, checkout: string) {
    return resolve(checkout, await tryGit(projectPath, 'rev-parse', '--show-prefix'))
  }

  async function root(threadId: string) {
    const { thread, project } = await locate(threadId)
    if (thread.environment !== 'worktree') return project.path
    return workingFolder(project.path, folderOf(project.id, threadId))
  }

  async function changes(folder: string) {
    const status = await git(folder, 'status', '--porcelain', '--untracked-files=all')
    return status ? status.split('\n').length : 0
  }

  // Removing a worktree deletes its HEAD's reflog, the only trace of commits made detached.
  async function strandsCommits(folder: string) {
    if (await git(folder, 'branch', '--show-current')) return false
    const refs = ['refs/heads', 'refs/remotes', 'refs/tags']
    return !(await git(folder, 'for-each-ref', '--count=1', '--contains', 'HEAD', ...refs))
  }

  async function detached(threadId: string) {
    const { thread, project } = await locate(threadId)
    if (thread.environment !== 'worktree') return false
    const folder = folderOf(project.id, threadId)
    return (await exists(folder)) && strandsCommits(folder)
  }

  async function refresh(threadId: string) {
    const folder = await root(threadId)
    const branch = await tryGit(folder, 'branch', '--show-current')
    if (branch)
      await run(store.setThreadGit(threadId, { branch, dirty: (await changes(folder)) > 0 }))
    onChange(await run(store.requireThread(threadId)))
  }

  async function save(threadId: string, record: WorktreeRecord) {
    await run(store.saveWorktree(threadId, record))
    await refresh(threadId)
  }

  // Copies gitignored files that match .worktreeinclude, like Claude Code does.
  async function copyIncluded(source: string, target: string) {
    const patterns = join(source, '.worktreeinclude')
    const custom = await Bun.file(patterns).exists()
    const listIgnored = ['ls-files', '--others', '--ignored', '-z']
    const ignored = await git(source, ...listIgnored, '--exclude-standard')
    const included = await git(
      source,
      ...listIgnored,
      ...(custom ? [`--exclude-from=${patterns}`] : defaultIncludes)
    )
    const wanted = new Set(included.split('\0'))
    for (const file of ignored.split('\0')) {
      if (!file || !wanted.has(file)) continue
      // The default means env files, not everything inside a `.env/` virtualenv.
      if (!custom && !basename(file).startsWith('.env')) continue
      const from = join(source, file)
      if (!(await lstat(from)).isFile()) continue
      await mkdir(dirname(join(target, file)), { recursive: true })
      await cp(from, join(target, file))
    }
  }

  function killSetup(child: ChildProcess) {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }

  function scriptEnv(folder: string, slot: number | null) {
    return {
      JETTY_WORKTREE_NAME: basename(folder),
      ...(slot === null ? {} : { JETTY_WORKTREE_SLOT: String(slot) }),
    }
  }

  async function runScript(
    name: WorktreeScript,
    script: string,
    cwd: string,
    env: Record<string, string>,
    signal?: AbortSignal
  ) {
    if (closing) throw new Error(`Worktree ${name} interrupted by shutdown`)
    const stopped = () => new Error(`Worktree ${name} stopped`)
    if (signal?.aborted) throw stopped()
    await new Promise<void>((resolve, reject) => {
      const child = spawn('sh', ['-c', supervised, 'sh', script], {
        cwd,
        env: { ...process.env, ...env },
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      setups.add(child)
      let output = ''
      let timedOut = false
      function capture(chunk: Buffer) {
        output = (output + chunk.toString()).slice(-64 * 1024)
      }
      function abort() {
        killSetup(child)
      }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => {
        timedOut = true
        killSetup(child)
      }, SETUP_TIMEOUT)
      function finish(error?: Error) {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        setups.delete(child)
        if (error) reject(error)
        else resolve()
      }
      child.once('error', finish)
      child.once('close', (code) =>
        finish(
          code === 0
            ? undefined
            : signal?.aborted
              ? stopped()
              : new Error(
                  timedOut
                    ? `Worktree ${name} timed out after 15 minutes`
                    : `Worktree ${name} failed: ${output.trim() || `exit ${code}`}`
                )
        )
      )
    })
  }

  async function prepareNow(threadId: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Worktree setup stopped')
    const { thread, project } = await locate(threadId)
    if (thread.environment !== 'worktree') {
      const head = await revParse(project.path, 'HEAD')
      if (head) await run(store.captureLocalBase(threadId, head))
      await refresh(threadId)
      return project.path
    }
    const folder = folderOf(project.id, threadId)
    const working = await workingFolder(project.path, folder)
    const record = await serialized(project.path, async () => {
      const record = await run(store.getWorktree(threadId))
      if (!record) throw new Error('Worktree has no base commit')
      const missing = !(await exists(folder))
      if (missing) {
        await git(project.path, 'worktree', 'prune')
        await mkdir(dirname(folder), { recursive: true })
        if (!record.branch) {
          record.branch = `${await run(store.getBranchPrefix())}/thread-${threadId}`
          record.temporaryBranch = record.branch
          await save(threadId, record)
        }
        const branch = record.branch
        const known = await tryGit(project.path, 'show-ref', '--verify', `refs/heads/${branch}`)
        if (!known && record.checkoutPath) throw new Error(`Worktree branch ${branch} is missing`)
        await git(
          project.path,
          'worktree',
          'add',
          ...(known ? [] : ['-b', branch]),
          '--',
          folder,
          known ? branch : record.baseCommit
        )
      }
      if (missing || record.slot === null) {
        record.slot = await run(store.allocateWorktreeSlot(threadId))
        record.checkoutPath = working
        record.state = 'pending'
        record.error = null
        await save(threadId, record)
      }
      return record
    })
    if (record.state !== 'ready') {
      record.state = 'setting_up'
      record.error = null
      await save(threadId, record)
      if (!(await isFolder(working)))
        throw new Error(`${basename(project.path)} isn't in this worktree's base commit`)
      const checkout = await git(project.path, 'rev-parse', '--show-toplevel')
      await copyIncluded(checkout, folder)
      const { setup } = await worktreeConfig(checkout)
      if (setup) await runScript('setup', setup, folder, scriptEnv(folder, record.slot), signal)
      record.state = 'ready'
      await save(threadId, record)
    }
    if (record.temporaryBranch && thread.title !== DEFAULT_THREAD_TITLE)
      await rename(threadId, thread.title).catch(() => {})
    await refresh(threadId)
    return working
  }

  // Resolves to the thread's working folder once it exists and its setup has run.
  function prepare(threadId: string, signal?: AbortSignal) {
    if (closing) return Promise.reject(new StoreError('conflict', 'Server is shutting down'))
    const existing = preparations.get(threadId)
    if (existing) return existing.pending
    const stop = new AbortController()
    const combined = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal
    const pending = prepareNow(threadId, combined)
      .then((folder) => {
        // A stop that lands once preparation is done (always, for a Current checkout: it has no
        // setup to kill) still means the turn waiting on it shouldn't start.
        if (combined.aborted) throw new Error('Worktree setup stopped')
        return folder
      })
      .catch(async (error: unknown) => {
        const record = await run(store.getWorktree(threadId))
        if (record) {
          // A user stop is not a failure: the composer says so in muted text. Shutdown and a
          // script that exits on its own stay failed.
          record.state = stop.signal.aborted ? 'stopped' : 'failed'
          record.error = error instanceof Error ? error.message : String(error)
          await run(store.setQueuePaused(threadId, true))
          await save(threadId, record)
        }
        throw error
      })
      .finally(() => preparations.delete(threadId))
    preparations.set(threadId, { pending, stop })
    return pending
  }

  // Stops the thread's running preparation. True if one ran.
  function stopSetup(threadId: string) {
    const preparation = preparations.get(threadId)
    preparation?.stop.abort()
    return preparation !== undefined
  }

  async function dirty(threadId: string) {
    const { thread, project } = await locate(threadId)
    if (thread.environment !== 'worktree') return 0
    const folder = folderOf(project.id, threadId)
    return (await exists(folder)) ? changes(folder) : 0
  }

  // Runs the archive script in the thread's worktree, if there is one to clean up after.
  async function cleanUp(threadId: string) {
    const { thread, project } = await locate(threadId)
    const folder = folderOf(project.id, threadId)
    if (thread.environment !== 'worktree' || !(await exists(folder))) return
    const { archive } = await worktreeConfig(
      await git(project.path, 'rev-parse', '--show-toplevel')
    )
    if (!archive) return
    const record = await run(store.getWorktree(threadId))
    await runScript('archive', archive, folder, scriptEnv(folder, record?.slot ?? null))
  }

  // A linked merged PR vouches only for a branch whose every commit it merged, so a branch
  // switched to later, or one that moved on after the merge, survives the thread's delete.
  async function mergedAway(cwd: string, branch: string, thread: ThreadMeta) {
    if (!(await tryGit(cwd, 'show-ref', '--verify', `refs/heads/${branch}`))) return false
    for (const link of thread.pullRequests ?? []) {
      if (link.state !== 'merged') continue
      const head = (await run(store.getPullRequest(link.repo, link.number))).data?.pull.head.sha
      if (!head) continue
      const contained = await git(cwd, 'merge-base', '--is-ancestor', `refs/heads/${branch}`, head)
        .then(() => true)
        .catch(() => false)
      if (contained) return true
    }
    return false
  }

  async function remove(threadId: string, deleting = false, cleanedUp = false) {
    const { thread, project } = await locate(threadId)
    if (thread.environment !== 'worktree') return
    if (preparations.has(threadId)) throw new StoreError('conflict', 'Worktree setup is running')
    const folder = folderOf(project.id, threadId)
    async function checkArchivable() {
      if (await changes(folder)) throw new StoreError('conflict', dirtyArchive)
      if (await strandsCommits(folder)) throw new StoreError('conflict', detachedArchive)
    }
    if (!deleting) {
      if (await exists(folder)) await checkArchivable()
      if (!cleanedUp) await cleanUp(threadId)
    }
    await serialized(project.path, async () => {
      const record = await run(store.getWorktree(threadId))
      if (!record) return
      if (await exists(folder)) {
        if (!deleting) await checkArchivable()
        // Resume checks out the branch the worktree is on now, wherever its work moved.
        const current = deleting ? '' : await tryGit(folder, 'branch', '--show-current')
        if (current && current !== record.branch) {
          record.branch = current
          record.temporaryBranch = null
        }
        await git(
          project.path,
          'worktree',
          'remove',
          ...(deleting ? ['--force'] : []),
          '--',
          folder
        )
      }
      await git(project.path, 'worktree', 'prune')
      if (deleting && record.branch && (await mergedAway(project.path, record.branch, thread)))
        await git(project.path, 'branch', '-D', '--', record.branch)
      record.slot = null
      record.state = 'pending'
      await save(threadId, record)
    })
  }

  // What git renamed the temporary branch to when the record missed it: a restart cut Jetty's
  // rename off before it was saved, or the agent renamed it.
  async function renamedTo(projectPath: string, folder: string, temporary: string) {
    if (await tryGit(projectPath, 'show-ref', '--verify', `refs/heads/${temporary}`)) return null
    const current = await tryGit(folder, 'branch', '--show-current')
    return current && current !== temporary ? current : null
  }

  // Renames the temporary branch after the title once, unless it was pushed or switched.
  async function rename(threadId: string, title: string) {
    const { thread, project } = await locate(threadId)
    if (thread.environment !== 'worktree') return
    const folder = folderOf(project.id, threadId)
    await serialized(project.path, async () => {
      const record = await run(store.getWorktree(threadId))
      const temporary = record?.temporaryBranch
      if (!record || !temporary || record.branch !== temporary) return
      const remoteHeads = (await hasOrigin(project.path))
        ? (await git(project.path, 'ls-remote', '--heads', 'origin'))
            .split('\n')
            .map((line) => line.split('\t')[1]?.replace('refs/heads/', ''))
        : []
      // Local and read after the remote round trip, so an agent's `git push -u` that finished
      // meanwhile still stops the rename.
      const current = await git(folder, 'branch', '--show-current')
      const upstream = await git(
        project.path,
        'for-each-ref',
        '--format=%(upstream)',
        `refs/heads/${temporary}`
      )
      if (current !== temporary || upstream || remoteHeads.includes(temporary)) {
        record.branch = (await renamedTo(project.path, folder, temporary)) ?? record.branch
        record.temporaryBranch = null
        await save(threadId, record)
        return
      }
      const refs = await git(
        project.path,
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads',
        'refs/remotes'
      )
      const occupied = new Set([
        ...refs.split('\n').map((ref) => ref.replace(/^refs\/heads\/|^refs\/remotes\/[^/]+\//, '')),
        ...remoteHeads,
      ])
      const base = `${await run(store.getBranchPrefix())}/${branchSlug(title)}`
      let next = base
      for (let suffix = 2; occupied.has(next); suffix++) next = `${base}-${suffix}`
      // Named, so a switch while the remote was being checked can't rename some other branch.
      await git(folder, 'branch', '-m', '--', temporary, next)
      record.branch = next
      record.temporaryBranch = null
      await save(threadId, record)
    })
  }

  async function reconcile() {
    for (const { threadId, record } of await run(store.listWorktrees())) {
      // An unarchived thread's removed worktree that was never recreated: a restart cut its Resume.
      const stranded =
        record.state === 'pending' &&
        record.checkoutPath &&
        !(await run(store.requireThread(threadId))).archived
      if (record.state === 'setting_up' || stranded) {
        record.state = 'failed'
        record.error = 'Worktree setup interrupted by server restart'
        await save(threadId, record)
      }
      if (record.state === 'failed' || record.state === 'stopped')
        await run(store.setQueuePaused(threadId, true))
      const temporary = record.temporaryBranch
      if (temporary && record.branch === temporary && record.checkoutPath) {
        const renamed = await locate(threadId)
          .then(({ project }) => renamedTo(project.path, folderOf(project.id, threadId), temporary))
          .catch(() => null)
        if (renamed) {
          record.branch = renamed
          record.temporaryBranch = null
          await save(threadId, record)
        }
      }
    }
  }

  async function shutdown() {
    closing = true
    for (const child of setups) killSetup(child)
    await Promise.allSettled([...preparations.values()].map(({ pending }) => pending))
  }

  return {
    branches,
    defaultEnvironment,
    resolveRef: async (cwd: string, ref?: string) => {
      await requireGit(cwd)
      return serialized(cwd, () => resolveRef(cwd, ref))
    },
    root,
    prepare,
    stopSetup,
    dirty,
    detached,
    cleanUp,
    remove,
    rename,
    refresh,
    reconcile,
    shutdown,
  }
}
