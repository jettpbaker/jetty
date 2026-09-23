import { useDiffFileLoader, useThreadDiff } from '@/state'
import { lazy, Suspense, useMemo } from 'react'

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
  }: {
    threadId: string
    patch: string
    notShown: readonly string[]
  }) {
    const files = useMemo(() => parseFileChanges(patch), [patch])
    const loadFile = useDiffFileLoader(threadId)
    return (
      <FileChangesViewer
        embedded
        files={files}
        loadFile={loadFile}
        footer={notShown.length > 0 && <NotShown paths={notShown} />}
      />
    )
  }
  return { default: PatchViewer }
})

const loading = <p className='p-4 text-xs text-muted-foreground'>Loading changes…</p>

export function ThreadChanges({ threadId }: { threadId: string }) {
  const { diff, failed } = useThreadDiff(threadId)
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
      <PatchViewer threadId={threadId} patch={diff.diff} notShown={notShown} />
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
