import type { ReadyAttachment } from '@/hooks/use-attachments'
import type { Reply, ThreadItem } from '@jetty/shared/items'
import type { Bot } from '@jetty/shared/wire'

import { StagedAttachments } from '@/components/custom/bot_attachments'
import { botAccentClass, botColorStyle } from '@/components/custom/bot_avatar'
import { BotConversation, type Room } from '@/components/custom/bot_conversation'
import { BotDecisionCard } from '@/components/custom/bot_decision_card'
import { ArrowUpIcon, StopIcon } from '@/components/custom/central_icons'
import { ComposerAttach } from '@/components/custom/composer_attach'
import { SlashMenu, SlashMirror, useComposerSlash } from '@/components/custom/composer_slash'
import { ReplyTab } from '@/components/custom/reply_quote'
import { linkMentions } from '@/components/custom/slash_model'
import { ThreadList } from '@/components/custom/thread_list'
import { Button } from '@/components/ui/button'
import { InputGroupTextarea } from '@/components/ui/input-group'
import { useAttachments } from '@/hooks/use-attachments'
import { useShowQuietTurns } from '@/lib/bot-quiet-turns'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'
import {
  useBotPresence,
  useBots,
  useChatComposer,
  useDraft,
  useInterruptTurn,
  usePendingBotMessages,
  useProject,
  useQuietThreadIds,
  useSendToBot,
  useThread,
  useThreadOverlay,
  withQuotes,
} from '@/state'
import { pendingTurnId } from '@/state/turns'
import { quietTurn } from '@jetty/shared/bots'
import { awaitsInput } from '@jetty/shared/items'
import { useMemo, useLayoutEffect, useRef, useState, type RefObject } from 'react'

function ignore() {}

// `overlayHost` is the page the bots' conversation opens over.
export function BotChat({ bot, overlayHost }: { bot: Bot; overlayHost: HTMLElement | null }) {
  const thread = useThread(bot.id)
  const pending = usePendingBotMessages(bot.id)
  const bots = useBots()
  const [showQuiet] = useShowQuietTurns()
  const rowOptions = useMemo(
    () => ({
      others: new Set(bots.flatMap((other) => (other.id === bot.id ? [] : [other.id]))),
      showQuiet,
    }),
    [bots, bot.id, showQuiet]
  )
  const [room, setRoom] = useState<Room>()
  const quietThreadIds = useQuietThreadIds()
  const project = useProject(bot.projectId ?? undefined)
  const sendToBot = useSendToBot()
  const interrupt = useInterruptTurn()
  // Quotes live in the draft, like a thread's, so a failed send brings them back with the text.
  const { draft, update: updateDraft, read: readDraft } = useDraft(bot.id)
  const replies = draft.quotes
  const setReplies = (quotes: readonly Reply[] | undefined) => updateDraft({ quotes })
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const overlay = useThreadOverlay(bot.id, thread)
  // A quiet thread's marker stays hidden until the thread surfaces, then shows where it was started.
  const items = useMemo(
    () => [
      ...overlay.items.filter(
        (item) => !(item.kind === 'thread_marker' && quietThreadIds.includes(item.threadId))
      ),
      ...pending.map(
        (message): ThreadItem => ({
          kind: 'user_message',
          id: message.id,
          turnId: pendingTurnId,
          createdAt: message.sentAt,
          text: message.text,
          attachments: message.attachments,
          ...(message.replies?.length && { replies: message.replies }),
        })
      ),
    ],
    [overlay.items, quietThreadIds, pending]
  )
  const turnId = thread?.activeTurnId
  // Only the bot's own card stops its turn; a worker waiting on Jett leaves it working.
  const asking = overlay.items.some(awaitsInput)
  // Stop lasts the whole turn, but not a turn Jetty started on its own until the bot speaks.
  const busy = turnId ? !asking && !quietTurn(items, turnId) : false
  function send(text: string, attachments: readonly ReadyAttachment[]) {
    sendToBot(bot.id, text, replies, [], attachments, bot.id)
    setReplies(undefined)
  }
  function reply(quote: Reply) {
    setReplies(withQuotes(readDraft().quotes, [quote]))
    fieldRef.current?.focus()
  }
  useChatComposer(bot.id, { edit: ignore, quote: reply, keepFocus: ignore })
  return (
    <div
      className='relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background'
      style={botColorStyle(bot.color)}
    >
      {thread || items.length > 0 ? (
        <ThreadList
          threadId={bot.id}
          items={items}
          status={thread?.status ?? 'idle'}
          running={overlay.running || pending.length > 0}
          outcomes={thread?.turnOutcomes}
          loadouts={thread?.turnLoadouts}
          projectPath={project?.path}
          provider={bot.provider}
          bot={rowOptions}
          onOpenRoom={setRoom}
        />
      ) : (
        <div className='min-h-0 flex-1' />
      )}
      <div className='mx-auto flex w-full max-w-[873px] shrink-0 flex-col gap-2 px-6 pb-4'>
        {overlay.items.map(
          (item) =>
            (item.kind === 'approval' || item.kind === 'question') &&
            awaitsInput(item) && <BotDecisionCard key={item.id} item={item} bot={bot} />
        )}
        <BotComposer
          key={bot.id}
          bot={bot}
          fieldRef={fieldRef}
          busy={busy}
          replies={replies}
          onRemoveReply={(index) => setReplies(withQuotes(replies?.toSpliced(index, 1)))}
          onSend={send}
          onStop={() => interrupt(bot.id)}
        />
      </div>
      {room && (
        <BotConversation
          key={room.botId}
          bot={bot}
          room={room}
          host={overlayHost}
          onClose={() => setRoom(undefined)}
        />
      )}
    </div>
  )
}

let measure: CanvasRenderingContext2D | null = null
function wraps(text: string, field: HTMLTextAreaElement, box: HTMLElement) {
  if (text.includes('\n')) return true
  measure ??= document.createElement('canvas').getContext('2d')
  if (!measure) return false
  measure.font = getComputedStyle(field).font
  return measure.measureText(text).width > box.clientWidth - 12 - 56 - 12
}

function BotComposer({
  bot,
  fieldRef,
  busy,
  replies,
  onRemoveReply,
  onSend,
  onStop,
}: {
  bot: Bot
  fieldRef: RefObject<HTMLTextAreaElement | null>
  busy: boolean
  replies?: readonly Reply[]
  onRemoveReply: (index: number) => void
  onSend: (text: string, attachments: readonly ReadyAttachment[]) => void
  onStop: () => void
}) {
  const { draft: storedDraft, update } = useDraft(bot.id)
  const attachments = useAttachments(bot.id, { keepFailed: true })
  const staged = attachments.items.length > 0
  const draft = storedDraft.text
  const others = useBots().filter((other) => other.id !== bot.id)
  const slash = useComposerSlash(draft, (text) => update({ text }), fieldRef, {
    projectId: bot.projectId ?? undefined,
    bot: true,
    mentions: others,
  })
  const { field, shown } = slash
  const [stacked, setStacked] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  // A failed image stays in view but sends nothing.
  const empty = !draft.trim() && attachments.items.every((item) => item.error)
  useBotPresence(bot.id, !empty)
  const stop = empty && busy
  // Measured as shown, chips and all.
  useLayoutEffect(() => {
    const textarea = fieldRef.current,
      box = boxRef.current
    setStacked(textarea && box ? wraps(shown, textarea, box) : false)
  }, [fieldRef, shown])
  function send() {
    if (empty || !attachments.ready) return
    onSend(linkMentions(draft.trim(), others), attachments.take())
    update({ text: '' })
    setStacked(false)
  }
  // Replying stacks the pill like a wrapped draft: the quotes, then the text, each on its own row
  // above the buttons. Staged images take a row of their own on top and leave the text beside them.
  const rows = stacked || replies
  let row = 1
  const imagesRow = staged ? row++ : 0
  const replyRow = replies ? row++ : 0
  const textRow = row
  const buttonsRow = rows ? ++row : row
  const errorRow = row + 1
  return (
    <div
      ref={boxRef}
      className={cn(
        'grid grid-cols-[auto_1fr_auto] items-center gap-x-1.5 rounded-[20px] bg-popover p-1.5',
        botAccentClass,
        (rows || staged) && 'gap-y-1.5'
      )}
    >
      {staged && (
        <div className='col-span-3 min-w-0' style={{ gridRow: imagesRow }}>
          <StagedAttachments items={attachments.items} onRemove={attachments.remove} />
        </div>
      )}
      {replies && (
        <div className='col-span-3 flex min-w-0 flex-col gap-1.5' style={{ gridRow: replyRow }}>
          {replies.map((reply, index) => (
            <ReplyTab
              key={`${reply.itemId}:${reply.text}`}
              text={reply.text}
              onClear={() => onRemoveReply(index)}
            />
          ))}
        </div>
      )}
      <div
        ref={field}
        data-composing={slash.composing || undefined}
        className={cn(
          'skill-chip-field relative col-start-2 min-w-0',
          rows && 'col-span-3 col-start-1'
        )}
        style={{ gridRow: textRow }}
      >
        <SlashMirror slash={slash} className={cn('p-0 text-sm', rows && 'px-1.5 pt-1')} />
        <InputGroupTextarea
          ref={fieldRef}
          rows={1}
          spellCheck={false}
          {...slash.input}
          placeholder={`Message ${bot.name}`}
          aria-label={`Message ${bot.name}`}
          onPaste={attachments.paste}
          onKeyDown={(event) => {
            if (event.defaultPrevented) return
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            } else if (event.key === 'Escape' && replies) onRemoveReply(replies.length - 1)
          }}
          className={cn(
            'skill-chip-text relative max-h-48 min-h-0 p-0 text-sm md:text-sm',
            rows && 'px-1.5 pt-1'
          )}
        />
        {slash.open && <SlashMenu slash={slash} />}
      </div>
      <div className='col-start-1 flex' style={{ gridRow: buttonsRow }}>
        <ComposerAttach
          onAttach={attachments.add}
          disabledReason={attachments.refused}
          className='rounded-full'
        />
      </div>
      <Button
        size='icon'
        aria-label={stop ? 'Stop' : 'Send'}
        disabled={stop ? false : empty || !attachments.ready}
        // Keep the caret in the draft.
        onMouseDown={(event) => event.preventDefault()}
        {...pressProps(stop ? onStop : send)}
        className='col-start-3 rounded-full'
        style={{ gridRow: buttonsRow }}
      >
        {stop ? <StopIcon filled /> : <ArrowUpIcon />}
      </Button>
      {attachments.error && (
        <p
          className='col-span-3 px-2 pb-0.5 text-xs text-destructive'
          style={{ gridRow: errorRow }}
        >
          {attachments.error}
        </p>
      )}
    </div>
  )
}
