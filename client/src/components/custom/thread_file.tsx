import { useProjectFile } from '@/state'
import { lazy, Suspense } from 'react'

import type { FileTarget } from './file_link'

const FileViewer = lazy(async () => ({ default: (await import('./file_viewer')).FileViewer }))

const loading = <p className='p-4 text-xs text-muted-foreground'>Loading file…</p>

export function ThreadFile({ threadId, target }: { threadId: string; target: FileTarget }) {
  const { file, failed } = useProjectFile(threadId, target.path)
  if (!file) {
    if (failed) return <p className='p-4 text-xs text-destructive'>Couldn&apos;t open file.</p>
    return loading
  }
  if ('unavailable' in file)
    return (
      <p className='p-4 text-xs text-muted-foreground'>
        {file.unavailable === 'binary' ? 'Binary file' : 'File too large to show'}
      </p>
    )
  if (file.contents === null)
    return <p className='p-4 text-xs text-muted-foreground'>File not found</p>
  return (
    <Suspense fallback={loading}>
      <FileViewer target={target} contents={file.contents} />
    </Suspense>
  )
}
