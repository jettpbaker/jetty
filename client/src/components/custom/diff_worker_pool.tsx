import type { FileDiffMetadata } from '@pierre/diffs'
import type { WorkerPoolManager } from '@pierre/diffs/worker'

import { preloadable } from '@/lib/preload'
import { WorkerPoolContext } from '@pierre/diffs/react'
import { useSyncExternalStore, type ReactNode } from 'react'

export const diffThemes = { light: 'pierre-light-soft', dark: 'pierre-dark-soft' } as const

let pool: WorkerPoolManager | undefined
let poolLoad: Promise<WorkerPoolManager | undefined> | undefined
const listeners = new Set<() => void>()

// Diff views highlight in workers. The pool starts with the first view that needs it, keeping the
// highlighter out of the app's first load, and views wait for it: one that mounts before the pool
// is ready paints blank. A pool whose workers fail leaves highlighting on the main thread.
export function loadDiffWorkerPool() {
  poolLoad ??= Promise.all([
    import('@pierre/diffs/worker'),
    import('@pierre/diffs/worker/worker.js?worker'),
  ]).then(
    async ([{ WorkerPoolManager }, { default: DiffsWorker }]) => {
      const created = new WorkerPoolManager(
        // Only the files on screen highlight at once, and each worker compiles every grammar it
        // meets for itself.
        { workerFactory: () => new DiffsWorker(), poolSize: 2 },
        // Shiki's JavaScript regex engine can hang on a pathological line.
        { theme: diffThemes, preferredHighlighter: 'shiki-wasm' }
      )
      await created.initialize().catch(() => {})
      pool = created
      for (const listener of listeners) listener()
      return created
    },
    () => undefined
  )
  return poolLoad
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function DiffWorkerPoolProvider({ children }: { children: ReactNode }) {
  const value = useSyncExternalStore(subscribe, () => pool)
  return <WorkerPoolContext value={value}>{children}</WorkerPoolContext>
}

// The Changes and PR Diff views' code, with the pool they highlight in.
export const diffViewer = preloadable(() =>
  Promise.all([
    import('./file_changes_viewer'),
    import('./file_diff_model'),
    loadDiffWorkerPool(),
  ]).then(([{ FileChangesViewer }, { parseFileChanges }]) => ({
    FileChangesViewer,
    parseFileChanges,
  }))
)

// About a screen of diff and the viewer's overscroll.
const firstPaintLines = 100

// The workers highlight the files a view paints first into the pool's cache, so it paints them
// coloured, and they compile those grammars before the view opens. The diffs need cache keys.
export async function primeDiffHighlights(diffs: readonly FileDiffMetadata[]) {
  const pool = await loadDiffWorkerPool()
  if (!pool?.isWorkingPool()) return
  let lines = 0
  for (const diff of diffs) {
    if (lines >= firstPaintLines) break
    lines += diff.unifiedLineCount
    void pool.primeDiffHighlightCache(diff).catch(() => {})
  }
}
