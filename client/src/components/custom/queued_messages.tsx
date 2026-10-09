import type { Attachment, ThreadItem } from '@jetty/shared/items'
import type { QueuedMessage } from '@jetty/shared/wire'

import { Cancel01Icon, Clock01Icon, Edit03Icon, PauseIcon } from '@/components/custom/huge_icons'
import { mediaUrl } from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { RepliedTo } from '@/components/custom/reply_quote'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { serverNow } from '@/lib/server_time'
import { cn } from '@/lib/utils'
import {
  chatComposer,
  useDraftEditing,
  useQueueActions,
  useQueueHeld,
  useRemovedQueued,
  useRequestReveal,
  useVisibleQueue,
} from '@/state'
import { heldByRestarts } from '@jetty/shared/items'
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'

import type { QueueState, TranscriptQueue } from './thread_rows'

import { FileLines, isImageAttachment } from './attachment_files'
import { ChatSeam, ChatSeamAction, SeamIcon } from './chat_seam'

const footer =
  'flex h-6 items-center gap-1 self-end text-xs whitespace-nowrap text-muted-foreground'
const reveal =
  'opacity-0 transition-opacity group-hover/message:opacity-100 has-focus-visible:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100'
const fade = 'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)'

// Clamped harder than a sent message (four lines, not 240px) so the live work above stays in view.
export function clampsQueued(text: string) {
  return text.split('\n').length > 4 || text.length > 280
}

// What the chat shows of the thread's queue; none for a subagent's tab.
export function useTranscriptQueue(
  threadId: string | undefined,
  items: readonly ThreadItem[]
): TranscriptQueue | undefined {
  const { queued, unsent, own } = useVisibleQueue(threadId, items)
  const paused = useQueueHeld(threadId)
  const editing = useDraftEditing(threadId ?? '')
  const removed = useRemovedQueued(threadId)
  const held = heldByRestarts(items)
  const lapsed = useHoldLapse(queued)
  return useMemo(
    () =>
      threadId === undefined ? undefined : { queued, unsent, own, paused, held, editing, removed },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a lapsed hold changes what rows read
    [threadId, queued, unsent, own, paused, held, editing, removed, lapsed]
  )
}

// Another tab's edit hold runs out on the server with no push (that tab closed), so the queue is
// read again when the nearest one does.
function useHoldLapse(queued: readonly QueuedMessage[]) {
  const [lapsed, lapse] = useReducer((count: number) => count + 1, 0)
  const until = Math.min(
    ...queued.map((entry) => entry.editingUntil ?? Infinity).filter((at) => at > serverNow())
  )
  useEffect(() => {
    if (until === Infinity) return
    const timer = setTimeout(lapse, until - serverNow() + 100)
    return () => clearTimeout(timer)
  }, [until, lapsed])
  return lapsed
}

function Images({ images }: { images: readonly Attachment[] }) {
  const openMedia = useOpenMedia()
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([])
  if (!images.length) return null
  return (
    <div className='no-scrollbar scroll-fade-x flex max-w-full gap-2 overflow-x-auto'>
      {images.map((image, index) => (
        <button
          key={image.id}
          ref={(element) => {
            thumbnails.current[index] = element
          }}
          type='button'
          aria-label={`Open ${image.name}`}
          className='shrink-0 cursor-zoom-in rounded-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
          onClick={() =>
            openMedia({ items: images, index, origin: (at) => thumbnails.current[at] ?? null })
          }
        >
          <img
            src={mediaUrl(image)}
            alt={image.name}
            decoding='async'
            draggable={false}
            className='size-12 rounded-sm object-cover ring-1 ring-border'
          />
        </button>
      ))}
    </div>
  )
}

function QueuedText({ entry, muted }: { entry: QueuedMessage; muted: boolean }) {
  const [open, setOpen] = useState(false)
  const long = clampsQueued(entry.text)
  const clamped = long && !open
  const images = (entry.attachments ?? []).filter(isImageAttachment)
  return (
    <>
      <Images images={images} />
      {entry.text && (
        <p
          className={cn(
            'leading-relaxed whitespace-pre-wrap',
            images.length > 0 && 'mt-2',
            clamped && 'overflow-hidden',
            muted && 'text-muted-foreground'
          )}
          style={clamped ? { maxHeight: '4lh', maskImage: fade, WebkitMaskImage: fade } : undefined}
        >
          {entry.text}
        </p>
      )}
      {long && (
        <Button
          variant='ghost-text'
          size='xs'
          className='mt-1 -ml-1 px-1'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : 'Show full message'}
        </Button>
      )}
    </>
  )
}

function TextAction({
  label,
  hint,
  onClick,
}: {
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant='ghost-text' size='xs' onClick={onClick} />}>
        {label}
      </TooltipTrigger>
      <TooltipContent side='bottom'>{hint}</TooltipContent>
    </Tooltip>
  )
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant='ghost' size='icon-xs' aria-label={label} onClick={onClick} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side='bottom'>{label}</TooltipContent>
    </Tooltip>
  )
}

// The queue as a group: its seam owns the state, so each bubble only reveals its actions.
export function QueueSeam({
  threadId,
  state,
  count,
  waiting = 0,
  resume,
}: {
  threadId: string
  state: QueueState
  count: number
  waiting?: number
  resume?: QueuedMessage
}) {
  const actions = useQueueActions()
  return (
    <ChatSeam>
      {state === 'paused' ? (
        <>
          <SeamIcon icon={PauseIcon} />
          <span className='truncate'>Paused{waiting > 0 ? ` · ${waiting} waiting` : ''}</span>
          {resume && (
            <ChatSeamAction onClick={() => actions.sendNow(threadId, resume)}>
              Resume
            </ChatSeamAction>
          )}
        </>
      ) : (
        <>
          <SeamIcon icon={Clock01Icon} />
          <span className='truncate'>
            {state === 'queued'
              ? count === 1
                ? 'Queued'
                : `${count} queued`
              : state === 'editing'
                ? 'Editing'
                : 'Sending…'}
          </span>
        </>
      )}
    </ChatSeam>
  )
}

export function QueuedBubble({
  threadId,
  entry,
  editing,
  steer,
}: {
  threadId: string
  entry: QueuedMessage
  editing: boolean
  steer: boolean
}) {
  const actions = useQueueActions()
  const requestReveal = useRequestReveal()
  const { replies } = entry
  // Steer and Remove unmount their button; a keyboard user goes back to the composer.
  function act(run: () => void) {
    return () => {
      chatComposer(threadId)?.keepFocus()
      run()
    }
  }
  return (
    <Message align='end'>
      <MessageContent className={cn(replies && 'gap-0.75')}>
        {replies?.map((reply) => (
          <RepliedTo
            key={`${reply.itemId}:${reply.text}`}
            text={reply.text}
            onJump={() => requestReveal(threadId, reply.itemId)}
          />
        ))}
        <FileLines
          files={(entry.attachments ?? []).filter((attachment) => !isImageAttachment(attachment))}
        />
        <Bubble variant={null} align='end'>
          <BubbleContent className='rounded-lg border-dashed border-primary bg-primary/8'>
            <QueuedText entry={entry} muted={editing} />
          </BubbleContent>
          {editing ? (
            <div className={footer}>
              <span className='flex items-center gap-1 px-1'>
                <Edit03Icon className='size-3' />
                Editing in the composer
              </span>
            </div>
          ) : (
            <div className={cn(footer, reveal)}>
              <TextAction
                label={steer ? 'Steer' : 'Send now'}
                hint={steer ? 'Send into the running turn' : 'Start a turn with this now'}
                onClick={act(() => actions.sendNow(threadId, entry))}
              />
              <IconAction label='Edit' onClick={() => chatComposer(threadId)?.edit(entry)}>
                <Edit03Icon />
              </IconAction>
              <IconAction
                label='Remove from the queue'
                onClick={act(() => actions.remove(threadId, entry.id))}
              >
                <Cancel01Icon />
              </IconAction>
            </div>
          )}
        </Bubble>
      </MessageContent>
    </Message>
  )
}

export function QueueRemoved({ threadId }: { threadId: string }) {
  const actions = useQueueActions()
  return (
    <div className='flex h-6 items-center justify-end gap-1 text-xs text-muted-foreground'>
      <span>Removed from the queue</span>
      <Button
        variant='ghost-text'
        size='xs'
        onClick={() => {
          chatComposer(threadId)?.keepFocus()
          actions.restore(threadId)
        }}
      >
        Undo
      </Button>
    </div>
  )
}
