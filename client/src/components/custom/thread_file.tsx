import { Loading } from '@/components/custom/loading'
import { useFileDirty, useProjectFile } from '@/state'
import { lazy, Suspense } from 'react'

import type { Checkout } from './file_editor'
import type { FileTarget } from './file_link'

import { loadDiffWorkerPool } from './diff_worker_pool'

const FileEditor = lazy(async () => {
  const [{ FileEditor }] = await Promise.all([import('./file_editor'), loadDiffWorkerPool()])
  return { default: FileEditor }
})

const loading = <Loading label='Loading file' />

export function ThreadFile({
  threadId,
  target,
  checkout,
}: {
  threadId: string
  target: FileTarget
  checkout: Checkout
}) {
  const { file, failed } = useProjectFile(threadId, target.path)
  // Unsaved edits stay open even once the file on disk can't be.
  const dirty = useFileDirty(threadId, target.path)
  if (!file) {
    if (failed) return <p className='p-4 text-xs text-destructive'>Couldn&apos;t open file.</p>
    return loading
  }
  if (!dirty && 'unavailable' in file)
    return (
      <p className='p-4 text-xs text-muted-foreground'>
        {file.unavailable === 'binary' ? 'Binary file' : 'File too large to show'}
      </p>
    )
  if (!dirty && 'contents' in file && file.contents === null)
    return <p className='p-4 text-xs text-muted-foreground'>File not found</p>
  return (
    <Suspense fallback={loading}>
      <FileEditor threadId={threadId} target={target} disk={file} checkout={checkout} />
    </Suspense>
  )
}
