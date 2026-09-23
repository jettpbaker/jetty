import type { ThreadItem } from '@jetty/shared/items'

import { Composer } from '@/components/custom/composer'
import { ComposerLoadout } from '@/components/custom/composer_loadout'
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
}: {
  threadId?: string
  items: readonly ThreadItem[]
  running: boolean
  rows: number
}) {
  const [draft, setDraft] = useState('')
  const { loadouts, catalog, setLoadouts } = useLoadouts()
  const { loadout, lockedProvider, setLoadout } = useThreadLoadout(threadId)
  const { accessMode, setAccessMode } = useAccessMode()
  const sendTurn = useSendTurn()
  const interruptTurn = useInterruptTurn()
  const createThread = useCreateThread()
  const navigate = useNavigate()
  const chrome = useChrome()
  const selectedId = useParams({ strict: false }).threadId
  const projectId = !threadId && chrome ? newThreadProject(chrome, selectedId) : undefined

  function submit() {
    const text = draft.trim()
    if (!text) return
    const id = threadId ?? (projectId ? createThread(projectId) : undefined)
    if (!id) return
    const prior = items.filter((item) => item.kind === 'user_message' && item.text === text).length
    setDraft('')
    sendTurn(id, text, prior, loadout)
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
        sendDisabled={!threadId && !projectId}
        loadout={
          loadout && (
            <ComposerLoadout
              catalog={catalog}
              loadouts={loadouts}
              value={loadout}
              lockedProvider={lockedProvider}
              onChange={setLoadout}
              onReorder={setLoadouts}
              onOpenSettings={() => void navigate({ to: '/settings' })}
            />
          )
        }
        accessMode={accessMode}
        onAccessModeChange={setAccessMode}
        rows={rows}
      />
    </div>
  )
}
