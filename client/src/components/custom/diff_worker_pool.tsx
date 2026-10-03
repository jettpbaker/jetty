import type { FileDiffMetadata, ThemesType } from '@pierre/diffs'
import type { WorkerPoolManager } from '@pierre/diffs/worker'

import { preloadable } from '@/lib/preload'
import { WorkerPoolContext } from '@pierre/diffs/react'
import { useSyncExternalStore, type ReactNode } from 'react'

export const diffThemes = { light: 'pierre-light-soft', dark: 'pierre-dark-soft' } as const

type PoolEntry = {
  pool?: WorkerPoolManager
  loading?: Promise<WorkerPoolManager | undefined>
  listeners: Set<() => void>
}
const pools = new Map<string, PoolEntry>()

function poolEntry(themes: ThemesType) {
  const key = `${themes.light}:${themes.dark}`
  let entry = pools.get(key)
  if (!entry) {
    entry = { listeners: new Set() }
    pools.set(key, entry)
  }
  return entry
}

// Theme resolution stays on the main thread; Pierre sends resolved registrations to its workers.
export function loadDiffWorkerPool(themes: ThemesType = diffThemes) {
  const entry = poolEntry(themes)
  entry.loading ??= Promise.all([
    import('@pierre/diffs/worker'),
    import('@pierre/diffs/worker/worker.js?worker'),
    import('@pierre/diffs').then(({ resolveThemes }) => resolveThemes([themes.light, themes.dark])),
  ]).then(
    async ([{ WorkerPoolManager }, { default: DiffsWorker }]) => {
      const created = new WorkerPoolManager(
        { workerFactory: () => new DiffsWorker(), poolSize: 2 },
        { theme: themes, preferredHighlighter: 'shiki-wasm' }
      )
      await created.initialize().catch(() => {})
      entry.pool = created
      for (const listener of entry.listeners) listener()
      return created
    },
    () => undefined
  )
  return entry.loading
}

export function useDiffWorkerPool(themes: ThemesType = diffThemes) {
  const entry = poolEntry(themes)
  return useSyncExternalStore(
    (listener) => {
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
      }
    },
    () => entry.pool
  )
}

export function DiffWorkerPoolProvider({
  children,
  themes = diffThemes,
}: {
  children: ReactNode
  themes?: ThemesType
}) {
  const value = useDiffWorkerPool(themes)
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
