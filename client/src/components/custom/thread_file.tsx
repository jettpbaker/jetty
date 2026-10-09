import type { Attachment } from '@jetty/shared/items'
import type { ProjectFile } from '@jetty/shared/wire'

import { Loading } from '@/components/custom/loading'
import { useFileDirty, useProjectFile } from '@/state'
import { lazy, Suspense, useEffect, useState } from 'react'

import type { Checkout } from './file_editor'
import type { FileTarget } from './file_link'

import { loadDiffWorkerPool } from './diff_worker_pool'
import { mediaUrl } from './media_layout'

const FileEditor = lazy(async () => {
  const [{ FileEditor }] = await Promise.all([import('./file_editor'), loadDiffWorkerPool()])
  return { default: FileEditor }
})

const loading = <Loading label='Loading file' />

export function ThreadFile({
  threadId,
  target,
  checkout,
  focus,
}: {
  threadId: string
  target: FileTarget
  checkout: Checkout
  focus: number
}) {
  if (target.attachment)
    return <AttachmentFile threadId={threadId} attachment={target.attachment} focus={focus} />
  return <ProjectFileView threadId={threadId} target={target} checkout={checkout} focus={focus} />
}

function ProjectFileView({
  threadId,
  target,
  checkout,
  focus,
}: {
  threadId: string
  target: FileTarget
  checkout: Checkout
  focus: number
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
      <FileEditor
        threadId={threadId}
        target={target}
        disk={file}
        checkout={checkout}
        focus={focus}
      />
    </Suspense>
  )
}

const noCheckout: Checkout = {}

// An attached file is Jetty's own copy, read from where the chat links it and never edited.
function AttachmentFile({
  threadId,
  attachment,
  focus,
}: {
  threadId: string
  attachment: Attachment
  focus: number
}) {
  const [file, setFile] = useState<ProjectFile | 'failed'>()
  useEffect(() => {
    let current = true
    setFile(undefined)
    fetch(mediaUrl(attachment))
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject()))
      .then((bytes) => {
        if (!current) return
        try {
          setFile({ contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes) })
        } catch {
          setFile({ unavailable: 'binary' })
        }
      })
      .catch(() => current && setFile('failed'))
    return () => {
      current = false
    }
  }, [attachment])
  if (file === 'failed')
    return <p className='p-4 text-xs text-destructive'>Couldn&apos;t open file.</p>
  if (!file) return loading
  if ('unavailable' in file) return <p className='p-4 text-xs text-muted-foreground'>Binary file</p>
  return (
    <Suspense fallback={loading}>
      <FileEditor
        threadId={threadId}
        target={{ path: attachment.name }}
        disk={file}
        checkout={noCheckout}
        focus={focus}
        locked
      />
    </Suspense>
  )
}
