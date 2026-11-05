import type { Attachment, ThreadItem } from '@jetty/shared/items'
import type { QueuedMessage, ThreadMeta } from '@jetty/shared/wire'

import {
  ClockIcon,
  CrossSmallIcon,
  Pencil2Icon,
  PauseIcon,
} from '@/components/custom/central_icons'
import { BotMentions } from '@/components/custom/entity_link'
import { mediaUrl } from '@/components/custom/media_layout'
import { MediaLightboxProvider, useOpenMedia } from '@/components/custom/media_lightbox'
import { RepliedTo } from '@/components/custom/reply_quote'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
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
import { DisabledTooltip } from './disabled_tooltip'
import { StatusGlyph } from './thread_status'
import { WorktreeSetupError } from './worktree_setup_error'

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

export function showsQueue(queue: ComposerQueueState | undefined) {
  return Boolean(
    queue &&
    (queue.own.length || queue.removed || (!queue.held && queue.paused && queue.unsent.length))
  )
}

// A message being edited can leave the queue under the composer: removed in another window, or
// delivered once its hold lapsed. The edit stays as an ordinary draft, and the footer says why.
export function useEditLeftQueue(
  editing: string | undefined,
  gone: boolean,
  empty: boolean,
  update: (patch: { editing: undefined }) => void
) {
  const [left, setLeft] = useState<string>()
  useEffect(() => {
    if (!gone || !editing) return
    setLeft(editing)
    update({ editing: undefined })
  }, [gone, editing, update])
  if (left !== undefined && empty) setLeft(undefined)
  return [left, setLeft] as const
}

export function QueuedEditNote({ left, items }: { left?: string; items: readonly ThreadItem[] }) {
  if (left === undefined)
    return (
      <span className='flex min-w-0 items-center gap-1.5'>
        <span className='truncate'>Editing a queued message</span>
        <Kbd>Esc</Kbd>
      </span>
    )
  return (
    <span className='truncate'>
      {items.some((entry) => entry.id === left)
        ? 'Already sent, so this is a new message'
        : 'No longer queued, so this is a new message'}
    </span>
  )
}

export function QueueOrSteerHint() {
  return (
    <span className='flex flex-col gap-1'>
      <span className='flex items-center justify-between gap-3'>
        Queue <Kbd>↵</Kbd>
      </span>
      <span className='flex items-center justify-between gap-3'>
        Steer now <Kbd>⌘↵</Kbd>
      </span>
    </span>
  )
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
          <BotMentions text={entry.text} />
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
            size='icon-sm'
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
  worktree,
}: {
  threadId: string
  queue: ComposerQueueState
  running: boolean
  worktree?: ThreadMeta['worktree']
}) {
  const actions = useQueueActions()
  const settingUp = worktree?.state === 'pending' || worktree?.state === 'setting_up'
  const retrySetup = worktree?.state === 'failed' || worktree?.state === 'stopped'
  const resume = queue.unsent.find((entry) => !isQueuedEditing(entry, queue.editing))
  const resumeInHeader = !queue.held && queue.paused && queue.unsent.length > 0
  return (
    <MediaLightboxProvider>
      <div className='flex flex-col divide-y divide-border first:rounded-t-md'>
        {resumeInHeader && (
          <div
            data-strip='queue'
            role={worktree?.state === 'failed' ? 'alert' : 'status'}
            className={cn(
              'flex gap-2 bg-popover px-2.5 py-3 text-sm first:rounded-t-md',
              retrySetup && worktree?.error ? 'items-start' : 'items-center',
              worktree?.state === 'failed' && 'border border-destructive/25 bg-destructive/10'
            )}
          >
            {settingUp ? (
              <Spinner className='size-4 shrink-0 text-muted-foreground' />
            ) : retrySetup ? (
              <StatusGlyph
                status={worktree?.state === 'failed' ? 'error' : 'stopped'}
                className={cn('size-4 shrink-0', worktree?.error && 'mt-1')}
              />
            ) : (
              <PauseIcon className='size-4 shrink-0 text-muted-foreground' />
            )}
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <span>
                {settingUp
                  ? 'Setting up worktree…'
                  : worktree?.state === 'failed'
                    ? 'Worktree setup failed'
                    : worktree?.state === 'stopped'
                      ? 'Worktree setup stopped'
                      : worktree?.state === 'ready'
                        ? 'Worktree ready · agent paused'
                        : 'Paused'}{' '}
                · {queue.unsent.length} queued {queue.unsent.length === 1 ? 'message' : 'messages'}
              </span>
              {retrySetup && worktree?.error && <WorktreeSetupError error={worktree.error} />}
            </div>
            {!settingUp && (
              <Button
                variant='default'
                size='sm'
                disabled={!resume}
                onClick={() => {
                  if (resume) actions.sendNow(threadId, resume)
                }}
              >
                {retrySetup
                  ? 'Retry setup & resume'
                  : queue.unsent.length > 1
                    ? 'Resume with next'
                    : 'Resume with message'}
              </Button>
            )}
          </div>
        )}
        {(queue.own.length > 0 || queue.removed) && (
          <div className='scrollbar-subtle flex max-h-64 flex-col divide-y divide-border overflow-y-auto'>
            {queue.own.map((entry) => (
              <QueuedRow
                key={entry.id}
                threadId={threadId}
                entry={entry}
                editing={isQueuedEditing(entry, queue.editing)}
                running={running}
                setupBlocked={settingUp || retrySetup}
                hideSend={
                  resumeInHeader &&
                  queue.unsent.length === 1 &&
                  resume?.id === entry.id &&
                  !settingUp &&
                  !retrySetup
                }
              />
            ))}
            {queue.removed && (
              <div data-strip='queue' className='bg-popover px-3 py-2 first:rounded-t-md'>
                <QueueRemoved threadId={threadId} />
              </div>
            )}
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
  setupBlocked,
  hideSend,
}: {
  setupBlocked: boolean
  hideSend: boolean
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
          <ClockIcon className='size-4 shrink-0 text-muted-foreground' />
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
          {!hideSend && (
            <DisabledTooltip
              reason={
                setupBlocked
                  ? 'Queued until worktree setup completes. Retry setup to continue.'
                  : undefined
              }
              wrap='flex'
            >
              <Button
                variant='ghost-text'
                size='sm'
                aria-label={
                  setupBlocked
                    ? 'Queued until setup completes'
                    : running
                      ? 'Steer with queued message'
                      : 'Send queued message now'
                }
                disabled={editing || setupBlocked}
                onClick={() => act(() => actions.sendNow(threadId, entry))}
              >
                {setupBlocked ? 'After setup' : running ? 'Steer now' : 'Run this next'}
              </Button>
            </DisabledTooltip>
          )}
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
