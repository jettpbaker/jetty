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

async function gitDiff(cwd: string): Promise<string> {
  try {
    const proc = Bun.spawn(['git', 'diff', 'HEAD'], { cwd, stdout: 'pipe', stderr: 'ignore' })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return code === 0 ? out : ''
  } catch {
    return ''
  }
}

export async function computeThreadDiff(store: Store, threadId: string): Promise<ThreadDiff> {
  const thread = store.getThread(threadId)
  if (!thread) return { diff: '' }
  const project = store.getProject(thread.projectId)
  if (!project) return { diff: '' }
  return truncateDiff(await gitDiff(project.path))
}
