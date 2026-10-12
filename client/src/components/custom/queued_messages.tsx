import type { Attachment, ThreadItem } from '@jetty/shared/items'
import type { QueuedMessage } from '@jetty/shared/wire'

import {
  ArrowShareLeftIcon,
  ArrowUpIcon,
  CrossSmallIcon,
  Pencil2Icon,
  PauseIcon,
} from '@/components/custom/central_icons'
import { mediaUrl } from '@/components/custom/media_layout'
import { MediaLightboxProvider, useOpenMedia } from '@/components/custom/media_lightbox'
import { RepliedTo } from '@/components/custom/reply_quote'
import { Button } from '@/components/ui/button'
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
import { isQueuedEditing } from '@/state/queue_editing'
import { heldByRestarts } from '@jetty/shared/items'
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'

import { FileLines, isImageAttachment } from './attachment_files'

type ComposerQueueState = {
  unsent: readonly QueuedMessage[]
  own: readonly QueuedMessage[]
  paused: boolean
  held: boolean
  editing?: string
  removed?: { message: QueuedMessage; index: number }
}

const fade = 'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)'

// Clamped harder than a sent message (four lines, not 240px) so the live work above stays in view.
function clampsQueued(text: string) {
  return text.split('\n').length > 4 || text.length > 280
}

export function useComposerQueue(
  threadId: string | undefined,
  items: readonly ThreadItem[]
): ComposerQueueState | undefined {
  const { queued, unsent, own } = useVisibleQueue(threadId, items)
  const paused = useQueueHeld(threadId)
  const editing = useDraftEditing(threadId ?? '')
  const removed = useRemovedQueued(threadId)
  const held = heldByRestarts(items)
  const lapsed = useHoldLapse(queued)
  return useMemo(
    () => (threadId === undefined ? undefined : { unsent, own, paused, held, editing, removed }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a lapsed hold changes what rows read
    [threadId, unsent, own, paused, held, editing, removed, lapsed]
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
            'text-sm leading-[22px] whitespace-pre-wrap wrap-anywhere',
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

function IconAction({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side='bottom'>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ComposerQueue({
  threadId,
  queue,
  running,
}: {
  threadId: string
  queue: ComposerQueueState
  running: boolean
}) {
  const actions = useQueueActions()
  const resume = queue.unsent.find((entry) => !isQueuedEditing(entry, queue.editing))
  return (
    <MediaLightboxProvider>
      <div className='scrollbar-subtle flex max-h-64 flex-col gap-0.5 overflow-y-auto first:rounded-t-md'>
        {queue.own.map((entry) => (
          <QueuedRow
            key={entry.id}
            threadId={threadId}
            entry={entry}
            editing={isQueuedEditing(entry, queue.editing)}
            running={running}
          />
        ))}
        {!queue.held && queue.paused && queue.unsent.length > 0 && (
          <div
            data-strip='queue'
            className='flex items-center gap-2 bg-popover px-3 py-2 text-xs text-muted-foreground first:rounded-t-md'
          >
            <PauseIcon className='size-3' />
            <span className='flex-1'>Paused · {queue.unsent.length} waiting</span>
            <Button
              variant='ghost-text'
              size='xs'
              disabled={!resume}
              onClick={() => {
                if (resume) actions.sendNow(threadId, resume)
              }}
            >
              Resume
            </Button>
          </div>
        )}
        {queue.removed && (
          <div data-strip='queue' className='bg-popover px-3 py-2 first:rounded-t-md'>
            <QueueRemoved threadId={threadId} />
          </div>
        )}
      </div>
    </MediaLightboxProvider>
  )
}

function QueuedRow({
  threadId,
  entry,
  editing,
  running,
}: {
  threadId: string
  entry: QueuedMessage
  editing: boolean
  running: boolean
}) {
  const actions = useQueueActions()
  const requestReveal = useRequestReveal()
  function act(run: () => void) {
    chatComposer(threadId)?.keepFocus()
    run()
  }
  return (
    <div
      data-strip='queue'
      data-queued-message={entry.id}
      className='flex flex-col gap-1 bg-popover px-3 py-2 first:rounded-t-md'
    >
      {entry.replies?.map((reply) => (
        <RepliedTo
          key={`${reply.itemId}:${reply.text}`}
          text={reply.text}
          onJump={() => requestReveal(threadId, reply.itemId)}
        />
      ))}
      <FileLines
        files={(entry.attachments ?? []).filter((attachment) => !isImageAttachment(attachment))}
      />
      <div className='flex min-w-0 items-center gap-4'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <ArrowShareLeftIcon className='size-3 shrink-0 translate-y-px text-muted-foreground' />
          <div className='min-w-0 flex-1'>
            <QueuedText entry={entry} muted={editing} />
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <IconAction
            label={editing ? 'Editing queued message' : 'Edit queued message'}
            disabled={editing}
            onClick={() => chatComposer(threadId)?.edit(entry)}
          >
            <Pencil2Icon />
          </IconAction>
          <IconAction
            label={running ? 'Steer with queued message' : 'Send queued message now'}
            disabled={editing}
            onClick={() => act(() => actions.sendNow(threadId, entry))}
          >
            <ArrowUpIcon />
          </IconAction>
          <IconAction
            label='Remove from the queue'
            disabled={editing}
            onClick={() => act(() => actions.remove(threadId, entry.id))}
          >
            <CrossSmallIcon />
          </IconAction>
        </div>
      </div>
    </div>
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
