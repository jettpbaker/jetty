import { Loading } from '@/components/custom/loading'
import { useProjectFile } from '@/state'
import { lazy, Suspense } from 'react'

import type { FileTarget } from './file_link'

import { loadDiffWorkerPool } from './diff_worker_pool'

const FileViewer = lazy(async () => {
  const [{ FileViewer }] = await Promise.all([import('./file_viewer'), loadDiffWorkerPool()])
  return { default: FileViewer }
})

const loading = <Loading label='Loading file' />

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
