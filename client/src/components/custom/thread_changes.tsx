import type { DiffScope } from '@jetty/shared/wire'

import { Loading } from '@/components/custom/loading'
import { whenIdle } from '@/lib/preload'
import {
  defaultDiffScope,
  useChrome,
  useDiffFileLoader,
  useThreadDiff,
  useThreadDiffFetch,
  useToolsSettled,
} from '@/state'
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import type { FileTarget } from './file_link'

import { ChangesScopePicker } from './changes_scope'
import { byTreeOrder } from './diff/model'
import { diffViewer, primeDiffHighlights } from './diff_worker_pool'

// A file link lands here first; `found` says whether it's among the changed files.
type OnTarget = (target: FileTarget, found: boolean) => void
type OnEditFile = (path: string) => void

function PatchViewer({
  threadId,
  patch,
  notShown,
  target,
  onTarget,
  scope,
  onScopeChange,
  onEditFile,
}: {
  threadId: string
  patch: string
  notShown: readonly string[]
  target?: FileTarget
  onTarget: OnTarget
  scope: DiffScope
  onScopeChange: (scope: DiffScope) => void
  onEditFile: OnEditFile
}) {
  const { FileChangesViewer, parseFileChanges } = diffViewer.useLoaded()
  const files = useMemo(() => parseFileChanges(patch), [patch, parseFileChanges])
  const loadFile = useDiffFileLoader(threadId, scope)
  const [reveal, setReveal] = useState<FileTarget>()
  useLayoutEffect(() => {
    if (!target) return
    const exact = files.find((file) => file.path === target.path)
    const suffix = exact ? [] : files.filter((file) => file.path.endsWith(`/${target.path}`))
    const match = exact ?? (suffix.length === 1 ? suffix[0] : undefined)
    if (match) setReveal({ ...target, path: match.path })
    onTarget(target, !!match)
  }, [target, files, onTarget])
  return (
    <FileChangesViewer
      scope={scope}
      onScopeChange={onScopeChange}
      files={files}
      loadFile={loadFile}
      reveal={reveal}
      onEditFile={onEditFile}
      footer={notShown.length > 0 && <NotShown paths={notShown} />}
    />
  )
}

// Once the thread has painted, again when its tool calls settle, and after each turn, its diff,
// the viewer and the first files' highlighting load behind it, so opening Changes paints them at
// once, coloured. No scope, no prefetch.
export function useThreadChangesPrefetch(
  threadId: string,
  scope: DiffScope | undefined,
  turnEndedAt: number | undefined
) {
  const fetchDiff = useThreadDiffFetch()
  useEffect(() => {
    if (!scope) return
    return whenIdle(
      () => void prefetchChanges(fetchDiff(threadId, scope, turnEndedAt)).catch(() => {})
    )
  }, [fetchDiff, threadId, scope, turnEndedAt])
  const refetch = useCallback(() => {
    if (scope) void prefetchChanges(fetchDiff(threadId, scope, turnEndedAt, true)).catch(() => {})
  }, [fetchDiff, threadId, scope, turnEndedAt])
  useToolsSettled(threadId, refetch)
}

// Each diff is parsed once, however often its thread is revisited.
const prefetched = new WeakSet<object>()

async function prefetchChanges(diff: Promise<{ diff: string }>) {
  const result = await diff
  if (result.diff === '' || prefetched.has(result)) return
  prefetched.add(result)
  const { parseFileChanges, syntaxTheme } = await diffViewer.preload()
  await primeDiffHighlights(
    parseFileChanges(result.diff)
      .sort(byTreeOrder)
      .map((file) => file.diff),
    syntaxTheme
  )
}

const loading = <Loading />

export function ThreadChanges({
  threadId,
  target,
  onTarget,
  onEditFile,
}: {
  threadId: string
  target?: FileTarget
  onTarget: OnTarget
  onEditFile: OnEditFile
}) {
  const [pickedScope, setScope] = useState<DiffScope>()
  const meta = useChrome()?.threads.find((thread) => thread.id === threadId)
  const scope = pickedScope ?? defaultDiffScope(meta)
  const { diff, failed } = useThreadDiff(threadId, scope)
  const nothingChanged = failed || diff?.diff === ''
  useLayoutEffect(() => {
    if (target && nothingChanged) onTarget(target, false)
  }, [target, nothingChanged, onTarget])
  if (!diff) {
    if (failed) return <p className='p-4 text-xs text-destructive'>Couldn&apos;t load changes.</p>
    return loading
  }
  const notShown = diff.truncatedPaths ?? []
  if (diff.diff === '')
    return (
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-9 shrink-0 items-center border-b border-border pl-2'>
          <ChangesScopePicker value={scope} onChange={setScope} />
        </div>
        <div className='flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center'>
          <p className='text-sm'>No changes</p>
          <p className='text-xs text-muted-foreground'>
            Edits in this thread&apos;s working folder will show here.
          </p>
        </div>
        {notShown.length > 0 && <NotShown paths={notShown} />}
      </div>
    )
  return (
    <Suspense fallback={loading}>
      <PatchViewer
        scope={scope}
        onScopeChange={setScope}
        threadId={threadId}
        patch={diff.diff}
        notShown={notShown}
        target={target}
        onTarget={onTarget}
        onEditFile={onEditFile}
      />
    </Suspense>
  )
}

function NotShown({ paths }: { paths: readonly string[] }) {
  return (
    <p
      className='shrink-0 truncate border-t border-border px-3 py-2 text-xs text-muted-foreground'
      title={paths.join('\n')}
    >
      Not shown: {paths.join(', ')}
    </p>
  )
}
