import { useDiffFileLoader, useThreadDiff } from '@/state'
import { lazy, Suspense, useLayoutEffect, useMemo, useState } from 'react'

import type { FileTarget } from './file_link'

// A file link lands here first; `found` says whether it's among the changed files.
type OnTarget = (target: FileTarget, found: boolean) => void

const PatchViewer = lazy(async () => {
  const [{ FileChangesViewer }, { parseFileChanges }, { preloadHighlighter }] = await Promise.all([
    import('./file_changes_viewer'),
    import('./file_diff_model'),
    import('@pierre/diffs'),
  ])
  await preloadHighlighter({
    themes: ['pierre-dark-soft', 'pierre-light-soft'],
    langs: ['typescript', 'tsx'],
  })
  function PatchViewer({
    threadId,
    patch,
    notShown,
    target,
    onTarget,
  }: {
    threadId: string
    patch: string
    notShown: readonly string[]
    target?: FileTarget
    onTarget: OnTarget
  }) {
    const files = useMemo(() => parseFileChanges(patch), [patch])
    const loadFile = useDiffFileLoader(threadId)
    const [reveal, setReveal] = useState<FileTarget>()
    useLayoutEffect(() => {
      if (!target) return
      const found = files.some((file) => file.path === target.path)
      if (found) setReveal(target)
      onTarget(target, found)
    }, [target, files, onTarget])
    return (
      <FileChangesViewer
        embedded
        files={files}
        loadFile={loadFile}
        reveal={reveal}
        footer={notShown.length > 0 && <NotShown paths={notShown} />}
      />
    )
  }
  return { default: PatchViewer }
})

const loading = <p className='p-4 text-xs text-muted-foreground'>Loading changes…</p>

export function ThreadChanges({
  threadId,
  target,
  onTarget,
}: {
  threadId: string
  target?: FileTarget
  onTarget: OnTarget
}) {
  const { diff, failed } = useThreadDiff(threadId)
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
        <div className='flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center'>
          <p className='text-sm'>No changes</p>
          <p className='text-xs text-muted-foreground'>
            Uncommitted edits in this thread&apos;s project will show here.
          </p>
        </div>
        {notShown.length > 0 && <NotShown paths={notShown} />}
      </div>
    )
  return (
    <Suspense fallback={loading}>
      <PatchViewer
        threadId={threadId}
        patch={diff.diff}
        notShown={notShown}
        target={target}
        onTarget={onTarget}
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
