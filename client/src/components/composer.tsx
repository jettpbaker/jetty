import type { SessionStatus } from '@jetty/shared/events'
import type { ChatStatus } from 'ai'
import type { MouseEvent } from 'react'

import { socket } from '@/app-state'
import {
  PromptInput,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { loadDraft, saveDraft } from '@/lib/draft'
import { type PendingSend, pendingSends, sendFirstTurn } from '@/state/pending'
import { newId } from '@jetty/shared/wire'
import { useNavigate } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

function chatStatus(status: SessionStatus): ChatStatus {
  return status === 'running' || status === 'starting' ? 'streaming' : 'ready'
}

export function Composer({ threadId, status }: { threadId: string; status: SessionStatus }) {
  const pending = useSyncExternalStore(pendingSends.subscribe, () => pendingSends.get(threadId))
  if (pending) return <FirstTurnComposer threadId={threadId} pending={pending} />
  return <ThreadComposer threadId={threadId} status={status} />
}

function ThreadComposer({ threadId, status }: { threadId: string; status: SessionStatus }) {
  const busy = status === 'running' || status === 'starting'

  function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim()
    if (!text) return
    void socket.request('turn.start', { threadId, text })
  }

  // The submit control sends while idle; while a turn runs it stops instead of
  // starting another (Enter still starts — the server steers the active turn).
  function handleSubmitClick(event: MouseEvent<HTMLButtonElement>) {
    if (!busy) return
    event.preventDefault()
    void socket.request('turn.interrupt', { threadId })
  }

  return (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder='Message the agent…' />
      <PromptInputFooter>
        <PromptInputSubmit
          className='ml-auto'
          status={chatStatus(status)}
          onClick={handleSubmitClick}
        />
      </PromptInputFooter>
    </PromptInput>
  )
}

// Holds the submitted first-turn text visible until the server confirms the
// thread. While sending it's read-only; on failure it reopens for edit + retry.
function FirstTurnComposer({ threadId, pending }: { threadId: string; pending: PendingSend }) {
  const sending = pending.phase === 'sending'

  function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim()
    if (!text) return
    return sendFirstTurn({ threadId, projectId: pending.projectId, text })
  }

  return (
    <PromptInputProvider initialInput={pending.text}>
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputTextarea placeholder='Message the agent…' disabled={sending} />
        <PromptInputFooter>
          <PromptInputSubmit
            className='ml-auto'
            status={sending ? 'submitted' : 'ready'}
            disabled={sending}
          />
        </PromptInputFooter>
      </PromptInput>
    </PromptInputProvider>
  )
}

export function DraftComposer({ projectId }: { projectId: string }) {
  const navigate = useNavigate()

  function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim()
    if (!text) return
    const threadId = newId()
    void navigate({ to: '/thread/$threadId', params: { threadId } })
    // Fire-and-forget: sets the pending entry synchronously (before the thread
    // route mounts) and chases the navigation with create → subscribe → start.
    void sendFirstTurn({ threadId, projectId, text }).catch(() => {})
  }

  return (
    <PromptInputProvider initialInput={loadDraft(projectId)}>
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputTextarea
          placeholder='Message the agent…'
          onChange={(event) => saveDraft(projectId, event.currentTarget.value)}
        />
        <PromptInputFooter>
          <PromptInputSubmit className='ml-auto' status='ready' />
        </PromptInputFooter>
      </PromptInput>
    </PromptInputProvider>
  )
}
