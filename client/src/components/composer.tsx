import type { SessionStatus } from '@jetty/shared/events'
import type { ChatStatus } from 'ai'
import type { MouseEvent, ReactNode } from 'react'

import { draftsStore, socket } from '@/app-state'
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { AttachmentFan } from '@/components/attachment-fan'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { acceptImages, toUploadAttachments } from '@/lib/attachments'
import { loadDraft, removeDraft, saveDraft } from '@/lib/draft'
import { APPROVAL_MODES, composerPrefs, MODELS } from '@/state/composer-prefs'
import { type PendingSend, pendingSends, sendFirstTurn } from '@/state/pending'
import { MAX_IMAGES_PER_TURN } from '@jetty/shared/wire'
import { PlusIcon } from '@phosphor-icons/react'
import { useNavigate } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

function chatStatus(status: SessionStatus): ChatStatus {
  return status === 'running' || status === 'starting' ? 'streaming' : 'ready'
}

// One shell everywhere: hairline border that brightens on focus-within.
const composerBase =
  'rounded-lg [&_[data-slot=input-group]]:bg-card! [&_[data-slot=input-group]]:ring-0!'
export const composerShell = `${composerBase} [&_[data-slot=input-group]]:border-border! [&_[data-slot=input-group]]:focus-within:border-white/25!`

// Footer: add-image and approval picker left, model+effort picker and send
// right. Extra controls (styleguide seed button) slot in via children.
export function ComposerFooter({
  status,
  disabled,
  onSubmitClick,
  children,
}: {
  status: ChatStatus
  disabled?: boolean
  onSubmitClick?: (event: MouseEvent<HTMLButtonElement>) => void
  children?: ReactNode
}) {
  const attachments = usePromptInputAttachments()
  const prefs = useSyncExternalStore(composerPrefs.subscribe, composerPrefs.getSnapshot)
  return (
    <div className='flex w-full items-center gap-1'>
      <PromptInputButton
        aria-label='Add images'
        disabled={disabled}
        onClick={() => attachments.openFileDialog()}
      >
        <PlusIcon className='size-4' />
      </PromptInputButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <PromptInputButton
              size='sm'
              disabled={disabled}
              className='text-muted-foreground transition-colors hover:bg-transparent! hover:text-foreground'
            >
              {prefs.approval.label}
            </PromptInputButton>
          }
        />
        <DropdownMenuContent align='start'>
          {APPROVAL_MODES.map((approval) => (
            <DropdownMenuItem key={approval.id} onClick={() => composerPrefs.set({ approval })}>
              {approval.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {children}
      <div className='ml-auto flex items-center gap-1'>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <PromptInputButton
                size='sm'
                disabled={disabled}
                className='group/model gap-1.5 text-foreground hover:bg-transparent!'
              >
                {prefs.model.label}
                <span className='text-muted-foreground transition-colors group-hover/model:text-foreground'>
                  {prefs.effort.label}
                </span>
              </PromptInputButton>
            }
          />
          <DropdownMenuContent align='end'>
            {MODELS.map((model) => (
              <DropdownMenuSub key={model.id}>
                <DropdownMenuSubTrigger>{model.label}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {model.efforts.map((effort) => (
                    <DropdownMenuItem
                      key={effort.id}
                      onClick={() => composerPrefs.set({ model, effort })}
                    >
                      {effort.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <PromptInputSubmit status={status} disabled={disabled} onClick={onSubmitClick} />
      </div>
    </div>
  )
}

/** The model/effort/permission params for a turn.start, from current prefs. */
export function turnPrefs() {
  const prefs = composerPrefs.getSnapshot()
  return {
    model: prefs.model.id,
    effort: prefs.effort.id,
    permissionMode: prefs.approval.id,
  }
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
    void socket.request('turn.start', { threadId, text, attachments, ...turnPrefs() })
  }

  // While a turn runs the button interrupts; Enter still submits (server steers).
  function handleSubmitClick(event: MouseEvent<HTMLButtonElement>) {
    if (!busy) return
    event.preventDefault()
    void socket.request('turn.interrupt', { threadId })
  }

  return (
    <div className='relative'>
      <PromptInputProvider validateFiles={acceptImages}>
        <AttachmentFan />
        <div className={`${composerShell} relative z-10`}>
          <PromptInput accept='image/*' multiple onSubmit={handleSubmit}>
            <PromptInputTextarea placeholder='Message the agent…' />
            <PromptInputFooter>
              <ComposerFooter status={chatStatus(status)} onSubmitClick={handleSubmitClick} />
            </PromptInputFooter>
          </PromptInput>
        </div>
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
    <div className='relative'>
      <PromptInputProvider initialInput={pending.text} validateFiles={acceptImages}>
        <AttachmentFan />
        <div className={`${composerShell} relative z-10`}>
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
            <PromptInputTextarea placeholder='Message the agent…' disabled={sending} />
            <PromptInputFooter>
              <ComposerFooter status={sending ? 'submitted' : 'ready'} disabled={sending} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </PromptInputProvider>
    </div>
  )
}

export function DraftComposer({ draftId, projectId }: { draftId: string; projectId: string }) {
  const navigate = useNavigate()

  function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim()
    const attachments = toUploadAttachments(message.files)
    if (!text && attachments.length === 0) return
    const threadId = draftId
    // remove the draft only after navigation commits — the draft page's
    // missing-draft redirect would otherwise race this navigate and win
    void navigate({ to: '/thread/$threadId', params: { threadId } }).then(() => {
      draftsStore.remove(draftId)
      removeDraft(draftId)
    })
    void sendFirstTurn({ threadId, projectId, text, attachments }).catch(() => {})
  }

  return (
    <div className='relative'>
      <PromptInputProvider initialInput={loadDraft(draftId)} validateFiles={acceptImages}>
        <AttachmentFan />
        <div className={`${composerShell} relative z-10`}>
          <PromptInput accept='image/*' multiple onSubmit={handleSubmit}>
            <PromptInputTextarea
              placeholder='Message the agent…'
              onChange={(event) => saveDraft(draftId, event.currentTarget.value)}
            />
            <PromptInputFooter>
              <ComposerFooter status='ready' />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </PromptInputProvider>
    </div>
  )
}
