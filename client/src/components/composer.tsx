import type { SessionStatus } from '@jetty/shared/events'
import type { ChatStatus } from 'ai'
import type { MouseEvent } from 'react'

import { socket } from '@/app-state'
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { acceptImages, toUploadAttachments } from '@/lib/attachments'
import { loadDraft, saveDraft } from '@/lib/draft'
import { useGlow } from '@/lib/glow/use-glow'
import { type PendingSend, pendingSends, sendFirstTurn } from '@/state/pending'
import { MAX_IMAGES_PER_TURN, newId } from '@jetty/shared/wire'
import { PaperclipIcon } from '@phosphor-icons/react'
import { useNavigate } from '@tanstack/react-router'
import { type RefObject, useRef, useSyncExternalStore } from 'react'

function chatStatus(status: SessionStatus): ChatStatus {
  return status === 'running' || status === 'starting' ? 'streaming' : 'ready'
}

// One composer shell everywhere: the draft's flush-black slab. Draft defines
// its edge with light; thread composers are the same object, lights off.
const composerShell =
  'rounded-lg [&_[data-slot=input-group]]:border-transparent! [&_[data-slot=input-group]]:bg-black! [&_[data-slot=input-group]]:ring-0!'

function AttachButton() {
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputButton aria-label='Attach images' onClick={() => attachments.openFileDialog()}>
      <PaperclipIcon className='size-4' />
    </PromptInputButton>
  )
}

function Attachments() {
  return (
    <PromptInputAttachments>
      {(attachment) => <PromptInputAttachment data={attachment} />}
    </PromptInputAttachments>
  )
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
    const attachments = toUploadAttachments(message.files)
    if (!text && attachments.length === 0) return
    void socket.request('turn.start', { threadId, text, attachments })
  }

  // While a turn runs the button interrupts; Enter still submits (server steers).
  function handleSubmitClick(event: MouseEvent<HTMLButtonElement>) {
    if (!busy) return
    event.preventDefault()
    void socket.request('turn.interrupt', { threadId })
  }

  return (
    <div className={composerShell}>
      <PromptInputProvider validateFiles={acceptImages}>
        <PromptInput accept='image/*' multiple onSubmit={handleSubmit}>
          <Attachments />
          <PromptInputTextarea placeholder='Message the agent…' />
          <PromptInputFooter>
            <AttachButton />
            <PromptInputSubmit
              className='ml-auto'
              status={chatStatus(status)}
              onClick={handleSubmitClick}
            />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}

// Pending attachments render as plain thumbnails: the strip can't rehydrate
// File objects from data URLs.
function FirstTurnComposer({ threadId, pending }: { threadId: string; pending: PendingSend }) {
  const sending = pending.phase === 'sending'

  function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim()
    const attachments = [...pending.attachments, ...toUploadAttachments(message.files)].slice(
      0,
      MAX_IMAGES_PER_TURN
    )
    if (!text && attachments.length === 0) return
    return sendFirstTurn({ threadId, projectId: pending.projectId, text, attachments })
  }

  return (
    <div className={composerShell}>
      <PromptInputProvider initialInput={pending.text} validateFiles={acceptImages}>
        <PromptInput accept='image/*' multiple onSubmit={handleSubmit}>
          {pending.attachments.length > 0 && (
            <div className='flex flex-wrap gap-2 p-2'>
              {pending.attachments.map((attachment) => (
                <img
                  key={attachment.dataUrl.slice(-24) + attachment.name}
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  className='max-h-16 rounded-md border'
                />
              ))}
            </div>
          )}
          <Attachments />
          <PromptInputTextarea placeholder='Message the agent…' disabled={sending} />
          <PromptInputFooter>
            <AttachButton />
            <PromptInputSubmit
              className='ml-auto'
              status={sending ? 'submitted' : 'ready'}
              disabled={sending}
            />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}

export function DraftComposer({
  projectId,
  glowContainerRef,
}: {
  projectId: string
  glowContainerRef?: RefObject<HTMLElement | null>
}) {
  const navigate = useNavigate()
  const glowTargetRef = useRef<HTMLDivElement>(null)
  const fallbackContainerRef = useRef<HTMLElement | null>(null)
  const glow = useGlow(glowTargetRef, glowContainerRef ?? fallbackContainerRef, {
    rim: { strength: 0.4 },
  })

  function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim()
    const attachments = toUploadAttachments(message.files)
    if (!text && attachments.length === 0) return
    glow.burst()
    const threadId = newId()
    void navigate({ to: '/thread/$threadId', params: { threadId }, viewTransition: true })
    void sendFirstTurn({ threadId, projectId, text, attachments }).catch(() => {})
  }

  return (
    <div ref={glowTargetRef} className={composerShell}>
      <PromptInputProvider initialInput={loadDraft(projectId)} validateFiles={acceptImages}>
        <PromptInput accept='image/*' multiple onSubmit={handleSubmit}>
          <Attachments />
          <PromptInputTextarea
            placeholder='Message the agent…'
            onChange={(event) => saveDraft(projectId, event.currentTarget.value)}
          />
          <PromptInputFooter>
            <AttachButton />
            <PromptInputSubmit className='ml-auto' status='ready' />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}
