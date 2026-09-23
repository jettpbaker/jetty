import type { ThreadItem } from '@jetty/shared/items'

import { Composer } from '@/components/custom/composer'
import { ComposerFooter } from '@/components/custom/composer_footer'
import { ComposerLoadout } from '@/components/custom/composer_loadout'
import { useImageAttachments } from '@/hooks/use-image-attachments'
import { findModel } from '@/lib/loadout'
import { newThreadProject } from '@/lib/thread_project'
import {
  useAccessMode,
  useChrome,
  useCreateThread,
  useInterruptTurn,
  useLoadouts,
  useSendTurn,
  useThreadLoadout,
} from '@/state'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

export function ThreadComposer({
  threadId,
  items,
  running,
  rows,
  ambient = false,
}: {
  threadId?: string
  items: readonly ThreadItem[]
  running: boolean
  rows: number
  ambient?: boolean
}) {
  const [draft, setDraft] = useState('')
  const attachments = useImageAttachments()
  const { loadouts, catalog, setLoadouts } = useLoadouts()
  const { loadout, lockedProvider, setLoadout } = useThreadLoadout(threadId)
  const { accessMode, setAccessMode } = useAccessMode()
  const sendTurn = useSendTurn()
  const interruptTurn = useInterruptTurn()
  const createThread = useCreateThread()
  const navigate = useNavigate()
  const chrome = useChrome()
  const selectedId = useParams({ strict: false }).threadId
  const [pickedProjectId, setPickedProjectId] = useState<string>()
  const projectId =
    !threadId && chrome ? (pickedProjectId ?? newThreadProject(chrome, selectedId)) : undefined
  const needsModel = !threadId && !loadout

  function submit() {
    const text = draft.trim()
    if (!text && attachments.images.length === 0) return
    const id = threadId ?? (projectId ? createThread(projectId) : undefined)
    if (!id) return
    const prior = items.filter((item) => item.kind === 'user_message' && item.text === text).length
    setDraft('')
    sendTurn(id, text, prior, loadout, attachments.take())
    if (!threadId) void navigate({ to: '/threads/$threadId', params: { threadId: id } })
  }

  return (
    <div className='mx-auto w-full max-w-[708px] px-6 pb-1'>
      <Composer
        value={draft}
        onValueChange={setDraft}
        onSubmit={submit}
        onInterrupt={() => {
          if (threadId) interruptTurn(threadId)
        }}
        running={running}
        sendDisabled={(!threadId && !projectId) || needsModel}
        sendHint={needsModel ? 'Choose a model first' : undefined}
        loadout={
          <ComposerLoadout
            catalog={catalog}
            loadouts={loadouts}
            value={loadout}
            lockedProvider={lockedProvider}
            onChange={setLoadout}
            onReorder={setLoadouts}
            onOpenSettings={() => void navigate({ to: '/settings' })}
          />
        }
        model={loadout && findModel(catalog, loadout)}
        accessMode={accessMode}
        onAccessModeChange={setAccessMode}
        attachments={attachments}
        context={
          threadId ? undefined : (
            <ComposerFooter projectId={projectId} onProjectChange={setPickedProjectId} />
          )
        }
        rows={rows}
        ambient={ambient}
      />
    </div>
  )
}
