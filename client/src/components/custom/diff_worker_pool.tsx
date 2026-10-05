import type { FileDiffMetadata } from '@pierre/diffs'
import type { WorkerPoolManager } from '@pierre/diffs/worker'

import { preloadable } from '@/lib/preload'
import { WorkerPoolContext } from '@pierre/diffs/react'
import { useSyncExternalStore, type ReactNode } from 'react'

import { syntaxTheme } from './syntax_theme'

const entry: {
  settled: boolean
  pool?: WorkerPoolManager
  loading?: Promise<WorkerPoolManager | undefined>
  listeners: Set<() => void>
} = { settled: false, listeners: new Set() }

function subscribe(listener: () => void) {
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
  }
}

// Theme resolution stays on the main thread; Pierre sends resolved registrations to its workers.
export function loadDiffWorkerPool() {
  entry.loading ??= Promise.all([
    import('@pierre/diffs/worker'),
    import('@pierre/diffs/worker/worker.js?worker'),
    import('@pierre/diffs').then(({ resolveThemes }) =>
      resolveThemes([syntaxTheme.light, syntaxTheme.dark])
    ),
  ])
    .then(
      async ([{ WorkerPoolManager }, { default: DiffsWorker }]) => {
        const created = new WorkerPoolManager(
          { workerFactory: () => new DiffsWorker(), poolSize: 2 },
          { theme: syntaxTheme, preferredHighlighter: 'shiki-wasm' }
        )
        await created.initialize().catch(() => {})
        entry.pool = created
        return created
      },
      () => undefined
    )
    .finally(() => {
      entry.settled = true
      for (const listener of entry.listeners) listener()
    })
  return entry.loading
}

function useDiffWorkerPool() {
  return useSyncExternalStore(subscribe, () => entry.pool)
}

export function useDiffWorkerPoolLoading() {
  return useSyncExternalStore(subscribe, () => !entry.settled)
}

export function DiffWorkerPoolProvider({ children }: { children: ReactNode }) {
  return <WorkerPoolContext value={useDiffWorkerPool()}>{children}</WorkerPoolContext>
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
export const firstPaintLines = 100

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
