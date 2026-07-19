import type { Store } from './store'

export type ThreadDiff = { diff: string; truncatedPaths?: string[] }

const LOCKFILE_NAMES = new Set([
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Cargo.lock',
])

/** Single-file diffs past this get their hunks stripped — a machine-generated
 *  blob no human wants to scroll, and enough to stall the renderer. */
const MAX_FILE_DIFF_BYTES = 128 * 1024

function isLockfile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return LOCKFILE_NAMES.has(base) || base.endsWith('.lock')
}

function filePath(section: string): string | null {
  const plus = section.match(/^\+\+\+ b\/(.+)$/m)
  if (plus?.[1] && plus[1] !== '/dev/null') return plus[1]
  const git = section.match(/^diff --git a\/.+ b\/(.+)$/m)
  return git?.[1] ?? null
}

/** Drop pathological file sections from a unified patch, listing their paths so
 *  the client can show the truncation without rendering the body. */
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
  return truncated.length > 0 ? { diff: kept.join(''), truncatedPaths: truncated } : { diff: kept.join('') }
}

async function git(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
  try {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'ignore' })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return { code, out }
  } catch {
    return { code: -1, out: '' }
  }
}

/** git's well-known empty tree — the diff base for a repo with no commits yet. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

async function gitDiff(cwd: string): Promise<string> {
  const head = await git(cwd, ['rev-parse', '--verify', 'HEAD'])
  const tracked = await git(cwd, ['diff', head.code === 0 ? 'HEAD' : EMPTY_TREE])
  if (tracked.code !== 0) return ''
  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard'])
  const parts = [tracked.out]
  for (const path of untracked.out.split('\n').filter((line) => line.length > 0)) {
    // --no-index exits 1 when the file has content — that's the success case
    const { out } = await git(cwd, ['diff', '--no-index', '--', '/dev/null', path])
    parts.push(out)
  }
  return parts.join('')
}

export async function computeThreadDiff(store: Store, threadId: string): Promise<ThreadDiff> {
  const thread = store.getThread(threadId)
  if (!thread) return { diff: '' }
  const project = store.getProject(thread.projectId)
  if (!project) return { diff: '' }
  return truncateDiff(await gitDiff(project.path))
}
