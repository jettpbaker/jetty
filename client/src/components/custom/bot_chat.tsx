import type { PendingBotMessage } from '@/state/bots'
import type { ThreadItem } from '@jetty/shared/items'
import type { Bot, ThreadMeta } from '@jetty/shared/wire'

import { botAccentClass, botColorStyle } from '@/components/custom/bot_avatar'
import {
  ApprovalStrip,
  QuestionStrip,
  useApproval,
  useQuestion,
} from '@/components/custom/composer_strip'
import { pendingItems } from '@/components/custom/composer_strip_model'
import { DisabledTooltip } from '@/components/custom/disabled_tooltip'
import { inlineLinkClass } from '@/components/custom/entity_link'
import {
  ArrowTurnBackwardIcon,
  ArrowUp02Icon,
  Cancel01Icon,
  Copy01Icon,
  PlusSignIcon,
  Refresh01Icon,
  StopIcon,
  Tick02Icon,
} from '@/components/custom/huge_icons'
import { JettyBot } from '@/components/custom/jetty_bot'
import { Markdown } from '@/components/custom/markdown'
import { StatusGlyph, threadStatus } from '@/components/custom/thread_status'
import { TranscriptMarker } from '@/components/custom/transcript_marker'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { InputGroupTextarea } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { emojiUrl } from '@/lib/fluent_emoji'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'
import {
  useChildThreadMetas,
  useDismissQuestion,
  useDraft,
  useInterruptTurn,
  usePendingBotMessages,
  useProject,
  useRespondApproval,
  useRespondQuestion,
  useSendToBot,
  useThread,
  useThreadMeta,
} from '@/state'
import { shownInBotChat } from '@jetty/shared/bots'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { toast } from 'sonner'

import './bot_chat.css'

const curve = [0.23, 1, 0.32, 1] as const
const EASE = `cubic-bezier(${curve.join(', ')})`
const glideMs = (distance: number) => Math.min(340, 220 + Math.abs(distance) * 0.6)
const RISE = 20
const RISE_SCALE = 0.96
const RISE_MS = 250
const RISE_FADE_MS = 160
const RISE_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'
const STAGGER = 90
const FADE_MS = 150
const EXIT_MS = 90
const SESSION_GAP = 30 * 60_000
const TIDY_NOTE = 'This can take a couple of minutes. Your message is next.'

type Message = {
  id: string
  from: 'jett' | 'bot'
  text: string
  at: number
  replyTo?: { itemId: string; text: string }
  reaction?: string
  streaming?: boolean
}

type Marker = Extract<ThreadItem, { kind: 'thread_marker' }>
type ErrorItem = Extract<ThreadItem, { kind: 'error' }>
type DecisionItem = Extract<ThreadItem, { kind: 'approval' | 'question' }>
type RowItem =
  | { kind: 'message'; message: Message }
  | { kind: 'markers'; markers: Marker[] }
  | { kind: 'error'; error: ErrorItem }
  | { kind: 'decision'; decision: DecisionItem }
type Gap = 'none' | 'run' | 'tight'
type Row = { key: string; gap: Gap } & ({ kind: 'stamp'; at: number } | RowItem)
type Presence = 'typing' | 'working' | 'tidying'
type Glide = { from: number; ms: number; start: number; animation: Animation }
type Arrival = { element: HTMLElement; kind: Row['kind'] | 'indicator'; gap: number }
const gapClass: Record<Gap, string> = { none: '', run: 'mt-3.5', tight: 'mt-0.75' }
const gapPx: Record<Gap, number> = { none: 0, run: 14, tight: 3 }

function bezier(t: number, a: number, b: number) {
  return 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3
}

function eased(x: number) {
  let lo = 0,
    hi = 1
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2
    if (bezier(t, curve[0], curve[2]) < x) lo = t
    else hi = t
  }
  return bezier(lo, curve[1], curve[3])
}

function offsetAt(glide: Glide | null, now: number) {
  const x = glide ? (now - glide.start) / glide.ms : 1
  return glide && x < 1 ? glide.from * (1 - eased(Math.max(0, x))) : 0
}

function timeUntil(glide: Glide, left: number) {
  const target = 1 - left / Math.abs(glide.from)
  if (target <= 0) return 0
  let lo = 0,
    hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (eased(mid) < target) lo = mid
    else hi = mid
  }
  return hi * glide.ms
}

function play(
  element: Element,
  keyframes: Keyframe[],
  duration: number,
  start: number,
  delay = 0,
  easing = EASE
) {
  const animation = element.animate(keyframes, { duration, delay, easing, fill: 'backwards' })
  animation.startTime = start
  return animation
}

function stamp(at: number, now: number) {
  const date = new Date(at)
  const days = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000
  )
  const day =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Yesterday'
        : date.toLocaleDateString('en-AU', { weekday: 'long' })
  return `${day} ${date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
}

function toItems(items: readonly ThreadItem[], pending: readonly PendingBotMessage[]): RowItem[] {
  const listed = new Set(items.map((item) => item.id))
  const visible: RowItem[] = []
  for (const item of items) {
    if (!shownInBotChat(item)) continue
    if (item.kind === 'assistant_message' && (item.streaming || !item.text.trim())) continue
    if (item.kind === 'user_message' || item.kind === 'assistant_message')
      visible.push({
        kind: 'message',
        message: {
          id: item.id,
          from: item.kind === 'user_message' ? 'jett' : 'bot',
          text: item.text,
          at: item.createdAt,
          ...(item.kind === 'user_message'
            ? { replyTo: item.replyTo, reaction: item.reaction }
            : { streaming: item.streaming }),
        },
      })
    else if (item.kind === 'thread_marker') {
      const last = visible.at(-1)
      if (
        last?.kind === 'markers' &&
        item.createdAt - last.markers.at(-1)!.createdAt <= SESSION_GAP
      )
        last.markers.push(item)
      else visible.push({ kind: 'markers', markers: [item] })
    } else if (item.kind === 'error') visible.push({ kind: 'error', error: item })
    else if (item.kind === 'approval' || item.kind === 'question') {
      if (item.kind === 'approval' ? item.decision : item.answers || item.dismissed)
        visible.push({ kind: 'decision', decision: item })
    }
  }
  for (const message of pending)
    if (!listed.has(message.id))
      visible.push({
        kind: 'message',
        message: {
          id: message.id,
          from: 'jett',
          text: message.text,
          at: message.sentAt,
          replyTo: message.replyTo,
        },
      })
  return visible
}

function toRows(items: RowItem[]): Row[] {
  const rows: Row[] = []
  let previous: RowItem | undefined
  for (const item of items) {
    const at =
      item.kind === 'message'
        ? item.message.at
        : item.kind === 'error'
          ? item.error.createdAt
          : item.kind === 'decision'
            ? item.decision.createdAt
            : item.markers[0]!.createdAt
    const key =
      item.kind === 'message'
        ? item.message.id
        : item.kind === 'error'
          ? item.error.id
          : item.kind === 'decision'
            ? item.decision.id
            : item.markers[0]!.id
    const prevAt =
      previous?.kind === 'message'
        ? previous.message.at
        : previous?.kind === 'error'
          ? previous.error.createdAt
          : previous?.kind === 'decision'
            ? previous.decision.createdAt
            : previous?.markers[0]?.createdAt
    const session = prevAt === undefined || at - prevAt > SESSION_GAP
    if (session)
      rows.push({ kind: 'stamp', key: `stamp-${key}`, at, gap: previous ? 'run' : 'none' })
    const sameSender =
      item.kind === 'message' &&
      previous?.kind === 'message' &&
      item.message.from === previous.message.from
    rows.push({
      ...item,
      key: `${item.kind}-${key}`,
      gap: session || !sameSender ? 'run' : 'tight',
    })
    previous = item
  }
  return rows
}

export function BotChat({ bot }: { bot: Bot }) {
  const thread = useThread(bot.id)
  const pending = usePendingBotMessages(bot.id)
  const childMetas = useChildThreadMetas(bot.id)
  const sendToBot = useSendToBot()
  const interrupt = useInterruptTurn()
  const calm = useReducedMotion() ?? false
  const [now] = useState(() => Date.now())
  const [replyTo, setReplyTo] = useState<{ itemId: string; text: string }>()
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const items = thread?.items ?? []
  const rows = toRows(toItems(items, pending))
  const streaming = items.some((item) => item.kind === 'assistant_message' && item.streaming)
  const repliedThisTurn = items.some(
    (item) =>
      item.kind === 'assistant_message' &&
      item.turnId === thread?.activeTurnId &&
      !item.streaming &&
      !!item.text.trim()
  )
  const presence = streaming
    ? 'typing'
    : bot.activity === 'idle' || (bot.activity === 'typing' && repliedThisTurn)
      ? null
      : bot.activity
  function send(text: string) {
    sendToBot(bot.id, text, replyTo)
    setReplyTo(undefined)
  }
  function jump(id: string) {
    const target = document.getElementById(`bot-message-${id}`)
    target?.scrollIntoView({ behavior: calm ? 'instant' : 'smooth', block: 'center' })
    target?.querySelector('[data-slot=bubble-content]')?.animate(
      [
        { outlineColor: 'var(--primary)', outlineWidth: '2px', outlineStyle: 'solid' },
        { outlineColor: 'transparent', outlineWidth: '2px', outlineStyle: 'solid' },
      ],
      { duration: calm ? 150 : 800 }
    )
  }
  return (
    <div
      className='flex min-h-0 flex-1 flex-col overflow-hidden bg-background'
      style={botColorStyle(bot.color)}
    >
      <div className='flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-6'>
        <div className='flex shrink-0 grow flex-col'>
          <div className='grow' />
          <Transcript
            rows={rows}
            now={now}
            presence={presence}
            bot={bot}
            childMetas={childMetas}
            calm={calm}
            loaded={thread !== undefined}
            onReply={(reply) => {
              setReplyTo(reply)
              fieldRef.current?.focus()
            }}
            onJump={jump}
          />
          <div className='sticky bottom-0 z-10 mx-auto w-full max-w-[660px] pt-4'>
            <div className='bg-background pb-4'>
              <BotComposer
                key={bot.id}
                bot={bot}
                fieldRef={fieldRef}
                busy={presence !== null}
                replyTo={replyTo}
                onClearReply={() => setReplyTo(undefined)}
                onSend={send}
                onStop={() => interrupt(bot.id)}
                items={items}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Transcript({
  rows,
  now,
  presence,
  bot,
  childMetas,
  calm,
  loaded,
  onReply,
  onJump,
}: {
  rows: Row[]
  now: number
  presence: Presence | null
  bot: Bot
  childMetas: readonly ThreadMeta[]
  calm: boolean
  loaded: boolean
  onReply: (reply: { itemId: string; text: string }) => void
  onJump: (id: string) => void
}) {
  const stackRef = useRef<HTMLDivElement>(null)
  const [seen] = useState(() => new Set(rows.map((row) => row.key)))
  const initializedRef = useRef(loaded)
  const stateRef = useRef({
    height: -1,
    glide: null as Glide | null,
    live: false,
    shown: false,
    exit: null as Animation | null,
  })
  const [prior, setPrior] = useState(presence)
  const [leaving, setLeaving] = useState<Presence | null>(null)
  if (presence !== prior) {
    setPrior(presence)
    setLeaving(presence || calm ? null : prior)
  }
  const indicator = presence ?? leaving
  useEffect(() => {
    const stack = stackRef.current
    if (!stack) return
    const observer = new ResizeObserver(() => {
      stateRef.current.height = stack.offsetHeight
    })
    observer.observe(stack)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const stack = stackRef.current
    const state = stateRef.current
    if (!stack) return
    const height = stack.offsetHeight
    const grew = state.height < 0 ? 0 : height - state.height
    state.height = height
    if (!initializedRef.current) {
      for (const row of rows) seen.add(row.key)
      if (!loaded) return
      initializedRef.current = true
      return
    }
    const start = Number(document.timeline.currentTime ?? performance.now())
    const arrivals: Arrival[] = []
    for (const row of rows) {
      if (seen.has(row.key)) continue
      seen.add(row.key)
      const element = [...stack.querySelectorAll<HTMLElement>('[data-row]')].find(
        (entry) => entry.dataset.row === row.key
      )
      if (element) arrivals.push({ element, kind: row.kind, gap: gapPx[row.gap] })
    }
    const face = stack.querySelector<HTMLElement>('[data-indicator]')
    const handoff = state.live && !presence
    if (presence && face && !state.shown)
      arrivals.push({ element: face, kind: 'indicator', gap: 20 })
    if (presence || !leaving) {
      state.exit?.cancel()
      state.exit = null
    }
    state.live = presence !== null
    state.shown = indicator !== null
    let glide: Glide | null = null
    if (grew && !calm) {
      const from = offsetAt(state.glide, start) + grew
      const ms = glideMs(from)
      state.glide?.animation.cancel()
      const animation = play(
        stack,
        [{ transform: `translateY(${from}px)` }, { transform: 'none' }],
        ms,
        start
      )
      glide = state.glide = { from, ms, start, animation }
    }
    const hold = (element: Element) => {
      if (glide)
        play(element, [{ translate: `0 ${-glide.from}px` }, { translate: '0 0' }], glide.ms, start)
    }
    if (leaving && face && !state.exit) {
      hold(face)
      const exit = face.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: EXIT_MS,
        easing: EASE,
        fill: 'forwards',
      })
      exit.startTime = start
      exit.onfinish = () => setLeaving(null)
      state.exit = exit
    }
    if (!arrivals.length) return
    const clear = glide ? timeUntil(glide, arrivals[0]!.gap + RISE) : 0
    const base = Math.max(clear, handoff && !calm ? EXIT_MS * 0.75 : 0)
    let index = 0
    for (const { element, kind } of arrivals) {
      const delay = base + (kind === 'message' ? index++ * STAGGER : 0)
      if (
        calm ||
        kind === 'stamp' ||
        kind === 'markers' ||
        kind === 'error' ||
        kind === 'decision'
      ) {
        play(element, [{ opacity: 0 }, { opacity: 1 }], FADE_MS, start, delay)
        continue
      }
      hold(element)
      play(
        element,
        [{ transform: `translateY(${RISE}px) scale(${RISE_SCALE})` }, { transform: 'none' }],
        RISE_MS,
        start,
        delay,
        RISE_EASE
      )
      play(element, [{ opacity: 0 }, { opacity: 1 }], RISE_FADE_MS, start, delay, RISE_EASE)
    }
  })
  return (
    <div ref={stackRef} className='relative mx-auto flex w-full max-w-[660px] flex-col pt-6'>
      {rows.map((row) =>
        row.kind === 'stamp' ? (
          <Stamp key={row.key} id={row.key} label={stamp(row.at, now)} gap={row.gap} />
        ) : row.kind === 'message' ? (
          <MessageRow
            key={row.key}
            id={row.key}
            message={row.message}
            gap={row.gap}
            onReply={onReply}
            onJump={onJump}
          />
        ) : row.kind === 'markers' ? (
          <MarkerRow
            key={row.key}
            id={row.key}
            markers={row.markers}
            gap={row.gap}
            metas={childMetas}
          />
        ) : row.kind === 'decision' ? (
          <div key={row.key} data-row={row.key} className={cn('px-1', gapClass[row.gap])}>
            <TranscriptMarker item={row.decision} provider={bot.provider} />
          </div>
        ) : (
          <ErrorRow key={row.key} id={row.key} error={row.error} name={bot.name} gap={row.gap} />
        )
      )}
      {indicator && (
        <Indicator presence={indicator} leaving={!presence} spaced={rows.length > 0} bot={bot} />
      )}
    </div>
  )
}

function Stamp({ id, label, gap }: { id: string; label: string; gap: Gap }) {
  return (
    <div
      data-row={id}
      className={cn('flex justify-center pt-1 text-xs text-muted-foreground', gapClass[gap])}
    >
      {label}
    </div>
  )
}

function MessageRow({
  id,
  message,
  gap,
  onReply,
  onJump,
}: {
  id: string
  message: Message
  gap: Gap
  onReply: (reply: { itemId: string; text: string }) => void
  onJump: (id: string) => void
}) {
  const jett = message.from === 'jett'
  return (
    <div className={cn('flex flex-col', gapClass[gap])}>
      <div
        data-row={id}
        id={`bot-message-${message.id}`}
        className={cn(
          'group/row flex flex-col',
          jett ? cn('origin-bottom-right', botAccentClass) : 'origin-bottom-left',
          message.reaction && 'pt-1.5'
        )}
      >
        {message.replyTo && (
          <button
            type='button'
            onClick={() => onJump(message.replyTo!.itemId)}
            className='mb-0.75 flex max-w-[380px] min-w-0 items-center gap-1.5 self-end rounded-[14px] border border-border px-2.5 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
          >
            <ArrowTurnBackwardIcon className='size-3 shrink-0' />
            <span className='min-w-0 truncate'>{plainQuote(message.replyTo.text)}</span>
          </button>
        )}
        <div className={cn('relative w-fit max-w-full', jett && 'ml-auto')}>
          <Bubble
            variant={jett ? 'default' : 'muted'}
            align={jett ? 'end' : 'start'}
            className={cn('max-w-[515px]', !jett && 'has-[pre,table]:max-w-full')}
          >
            <BubbleContent
              className={cn(
                'rounded-[18.5px] border-0 leading-normal',
                jett
                  ? 'whitespace-pre-wrap selection:bg-primary-foreground/25 selection:text-primary-foreground'
                  : 'bot-reply'
              )}
            >
              {jett ? message.text : <Markdown>{message.text}</Markdown>}
            </BubbleContent>
            {message.reaction && (
              <span className='absolute -left-[3px] -top-[9px] flex size-[22px] items-center justify-center rounded-full border-2 border-background bg-accent'>
                <img src={emojiUrl(message.reaction)} alt={message.reaction} className='size-3' />
              </span>
            )}
          </Bubble>
          <MessageActions
            side={jett ? 'left' : 'right'}
            text={message.text}
            onReply={() => onReply({ itemId: message.id, text: message.text })}
          />
        </div>
      </div>
    </div>
  )
}

function MessageActions({
  text,
  onReply,
  side,
}: {
  text: string
  onReply: () => void
  side: 'left' | 'right'
}) {
  const [copied, setCopied] = useState(false)
  const calm = useReducedMotion() ?? false
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div
      className={cn(
        'absolute bottom-1 flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none',
        side === 'left' ? 'right-full mr-1.5 flex-row-reverse' : 'left-full ml-1.5'
      )}
    >
      <Button
        variant='ghost'
        size='icon-xs'
        aria-label={copied ? 'Copied' : 'Copy message'}
        className='relative active:scale-[0.97] active:transition-transform active:duration-150'
        onClick={() =>
          void navigator.clipboard.writeText(text).then(
            () => setCopied(true),
            () => toast.error("Couldn't copy")
          )
        }
      >
        <AnimatePresence initial={false} mode='sync'>
          {copied ? (
            <motion.span
              key='tick'
              className='absolute inset-0 flex items-center justify-center'
              initial={{
                opacity: 0,
                scale: calm ? 1 : 0.9,
                filter: calm ? 'blur(0px)' : 'blur(2px)',
              }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: calm ? 1 : 0.9, filter: calm ? 'blur(0px)' : 'blur(2px)' }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            >
              <Tick02Icon />
            </motion.span>
          ) : (
            <motion.span
              key='copy'
              className='absolute inset-0 flex items-center justify-center'
              initial={{
                opacity: 0,
                scale: calm ? 1 : 0.9,
                filter: calm ? 'blur(0px)' : 'blur(2px)',
              }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: calm ? 1 : 0.9, filter: calm ? 'blur(0px)' : 'blur(2px)' }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            >
              <Copy01Icon />
            </motion.span>
          )}
        </AnimatePresence>
      </Button>
      <Button
        variant='ghost'
        size='icon-xs'
        aria-label='Reply to message'
        className='active:scale-[0.97] active:transition-transform active:duration-150'
        onClick={onReply}
      >
        <ArrowTurnBackwardIcon />
      </Button>
    </div>
  )
}

function Indicator({
  presence,
  leaving,
  spaced,
  bot,
}: {
  presence: Presence
  leaving: boolean
  spaced: boolean
  bot: Bot
}) {
  const textRef = useRef<HTMLDivElement>(null)
  const shownRef = useRef(presence)
  useLayoutEffect(() => {
    if (shownRef.current === presence) return
    shownRef.current = presence
    textRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: EASE })
  }, [presence])
  const tidying = presence === 'tidying'
  return (
    <div
      data-indicator
      style={{ transformOrigin: `left calc(100% - ${tidying ? 24 : 20}px)` }}
      className={cn(
        'flex items-center gap-2 pb-1.5',
        spaced ? 'pt-5' : 'pt-1.5',
        leaving && 'pointer-events-none'
      )}
    >
      <JettyBot
        shape={bot.shape}
        color={bot.color}
        state={presence === 'typing' ? 'thinking' : presence}
        size={28}
      />
      <div ref={textRef} className='flex min-w-0 flex-col'>
        <span className='block text-sm whitespace-nowrap text-muted-foreground shimmer motion-reduce:shimmer-none'>
          {bot.name} is {tidying ? 'tidying its notes' : presence}
        </span>
        {tidying && <span className='text-xs text-muted-foreground'>{TIDY_NOTE}</span>}
      </div>
    </div>
  )
}

function MarkerLink({ marker }: { marker: Marker }) {
  const meta = useThreadMeta(marker.threadId)
  const status = threadStatus(meta?.status ?? 'idle', meta?.readyForReview)
  return (
    <span className='inline-flex min-w-0 items-center gap-[3px]'>
      <StatusGlyph status={status} className='size-3' />
      <Link
        to='/threads/$threadId'
        params={{ threadId: marker.threadId }}
        className={cn(inlineLinkClass, 'max-w-60 truncate')}
      >
        {meta?.title ?? marker.title}
      </Link>
    </span>
  )
}

function MarkerMenuEntry({ marker }: { marker: Marker }) {
  const meta = useThreadMeta(marker.threadId)
  const project = useProject(meta?.projectId)
  return (
    <Link
      to='/threads/$threadId'
      params={{ threadId: marker.threadId }}
      className='flex h-7.5 min-w-0 items-center gap-2 rounded-menu-item px-2 text-xs text-foreground outline-none hover:bg-accent focus-visible:bg-accent'
    >
      <StatusGlyph
        status={threadStatus(meta?.status ?? 'idle', meta?.readyForReview)}
        className='size-3.5'
      />
      <span className='min-w-0 flex-1 truncate'>{meta?.title ?? marker.title}</span>
      <span className='shrink-0 text-muted-foreground'>{project?.title}</span>
    </Link>
  )
}

function MarkerRun({ markers, metas }: { markers: Marker[]; metas: readonly ThreadMeta[] }) {
  const first = markers[0]!
  const sameThread = markers.every((marker) => marker.threadId === first.threadId)
  if (first.action === 'messaged' && sameThread && markers.length > 1)
    return (
      <span className='inline-flex items-center gap-[5px]'>
        <span className='text-foreground'>{markers.length}</span> messages to{' '}
        <MarkerLink marker={first} />
      </span>
    )
  if (first.action === 'started' && markers.length === 2)
    return (
      <span className='inline-flex items-center gap-[5px]'>
        Started <MarkerLink marker={first} /> and <MarkerLink marker={markers[1]!} />
      </span>
    )
  if (first.action === 'started' && markers.length >= 3)
    return (
      <span className='inline-flex items-center gap-[5px]'>
        Started{' '}
        <Popover>
          <PopoverTrigger className='rounded-sm text-foreground hover:underline'>
            {markers.length} threads
          </PopoverTrigger>
          <PopoverContent className='w-75 gap-0 rounded-sm p-1'>
            <PopoverTitle className='sr-only'>Started threads</PopoverTitle>
            {markers.map((marker) => (
              <MarkerMenuEntry key={marker.id} marker={marker} />
            ))}
          </PopoverContent>
        </Popover>
        <span className='inline-flex items-center gap-[7px] pl-0.5'>
          <MarkerTallies markers={markers} metas={metas} />
        </span>
      </span>
    )
  return (
    <span className='inline-flex items-center gap-[5px]'>
      {first.action === 'started' ? 'Started' : 'Messaged'} <MarkerLink marker={first} />
    </span>
  )
}

function MarkerTallies({ markers, metas }: { markers: Marker[]; metas: readonly ThreadMeta[] }) {
  const tally = new Map<ReturnType<typeof threadStatus>, number>()
  for (const marker of markers) {
    const meta = metas.find((entry) => entry.id === marker.threadId)
    const status = threadStatus(meta?.status ?? 'idle', meta?.readyForReview)
    tally.set(status, (tally.get(status) ?? 0) + 1)
  }
  return [...tally].map(([status, count]) => (
    <span
      key={status}
      className='inline-flex items-center gap-[3px] font-mono text-muted-foreground'
    >
      <StatusGlyph status={status} className='size-3' />
      {count}
    </span>
  ))
}

function MarkerRow({
  id,
  markers,
  gap,
  metas,
}: {
  id: string
  markers: Marker[]
  gap: Gap
  metas: readonly ThreadMeta[]
}) {
  const groups: Marker[][] = []
  for (const marker of markers) {
    const previous = groups.at(-1)
    if (
      previous?.[0]?.action === marker.action &&
      (marker.action === 'started' || previous[0].threadId === marker.threadId)
    )
      previous.push(marker)
    else groups.push([marker])
  }
  return (
    <div
      data-row={id}
      className={cn(
        'flex flex-col items-center gap-1 text-xs text-muted-foreground',
        gapClass[gap]
      )}
    >
      {groups.map((group) => (
        <div key={group[0]!.id} className='flex min-w-0 items-center justify-center py-0.5'>
          <MarkerRun markers={group} metas={metas} />
        </div>
      ))}
    </div>
  )
}

function ErrorRow({
  id,
  error,
  name,
  gap,
}: {
  id: string
  error: ErrorItem
  name: string
  gap: Gap
}) {
  return (
    <div data-row={id} className={cn('flex flex-col items-start gap-1.5', gapClass[gap])}>
      <div className='max-w-[515px] rounded-xl bg-(--status-error-wash) px-3 py-2 text-sm leading-normal text-status-error'>
        {name}’s turn failed: {sentenceCase(error.message)}
      </div>
      <DisabledTooltip reason='Coming soon' wrap='flex'>
        <Button variant='ghost-text' size='xs' disabled className='ml-1 gap-1.5'>
          <Refresh01Icon />
          Retry
        </Button>
      </DisabledTooltip>
    </div>
  )
}

// "The model provider is overloaded." reads on after the colon as "the model provider…"; an
// acronym ("API …") keeps its capitals.
function sentenceCase(message: string) {
  return /^[A-Z][a-z]/.test(message) ? message[0]!.toLowerCase() + message.slice(1) : message
}

function plainQuote(markdown: string) {
  return markdown
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '')
    .trim()
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
  replyTo,
  onClearReply,
  onSend,
  onStop,
  items,
}: {
  bot: Bot
  fieldRef: RefObject<HTMLTextAreaElement | null>
  busy: boolean
  replyTo?: { itemId: string; text: string }
  onClearReply: () => void
  onSend: (text: string) => void
  onStop: () => void
  items: readonly ThreadItem[]
}) {
  const { draft: storedDraft, update } = useDraft(bot.id)
  const draft = storedDraft.text
  const [stacked, setStacked] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const empty = !draft.trim()
  const stop = empty && busy
  const pending = pendingItems(items, { provider: bot.provider })
  const request = pending.at(-1)
  const answer = request && (
    <BotRequest key={request.id} request={request} botId={bot.id} fieldRef={fieldRef} />
  )
  function change(text: string) {
    update({ text })
    const field = fieldRef.current,
      box = boxRef.current
    setStacked(field && box ? wraps(text, field, box) : false)
  }
  function send() {
    if (empty) return
    onSend(draft.trim())
    update({ text: '' })
    setStacked(false)
  }
  if (request) return answer
  // Replying stacks the pill like a wrapped draft, with the quote on a row above the text.
  const rows = stacked || replyTo
  return (
    <div
      ref={boxRef}
      className={cn(
        'grid grid-cols-[auto_1fr_auto] items-center gap-x-1.5 rounded-[20px] bg-popover p-1.5',
        botAccentClass,
        rows && 'gap-y-1.5'
      )}
    >
      {replyTo && (
        <div className='col-span-3 row-start-1 flex h-8 min-w-0 items-center gap-2 rounded-[14px] bg-accent pr-1 pl-2.5 text-13 text-muted-foreground'>
          <ArrowTurnBackwardIcon className='size-3 shrink-0' />
          <span className='min-w-0 flex-1 truncate'>{plainQuote(replyTo.text)}</span>
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label='Clear reply'
            className='rounded-[10px]'
            onClick={onClearReply}
          >
            <Cancel01Icon />
          </Button>
        </div>
      )}
      <InputGroupTextarea
        ref={fieldRef}
        rows={1}
        value={draft}
        placeholder={`Message ${bot.name}`}
        aria-label={`Message ${bot.name}`}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
          } else if (event.key === 'Escape' && replyTo) onClearReply()
        }}
        className={cn(
          'col-start-2 row-start-1 max-h-48 min-h-0 p-0 text-sm md:text-sm',
          rows && 'col-span-3 col-start-1 px-1.5 pt-1',
          replyTo && 'row-start-2'
        )}
      />
      <Button
        variant='ghost'
        tone='muted'
        size='icon'
        disabled
        aria-label='Attach'
        className={cn(
          'col-start-1 row-start-1 rounded-full',
          stacked && 'row-start-2',
          replyTo && 'row-start-3'
        )}
      >
        <PlusSignIcon />
      </Button>
      <Button
        size='icon'
        aria-label={stop ? 'Stop' : 'Send'}
        disabled={empty && !busy}
        // Keep the caret in the draft.
        onMouseDown={(event) => event.preventDefault()}
        {...pressProps(stop ? onStop : send)}
        className={cn(
          'col-start-3 row-start-1 rounded-full',
          stacked && 'row-start-2',
          replyTo && 'row-start-3'
        )}
      >
        {stop ? <StopIcon filled /> : <ArrowUp02Icon />}
      </Button>
    </div>
  )
}

function BotRequest({
  request,
  botId,
  fieldRef,
}: {
  request: ReturnType<typeof pendingItems>[number]
  botId: string
  fieldRef: RefObject<HTMLTextAreaElement | null>
}) {
  const { draft, update } = useDraft(botId)
  const respondQuestion = useRespondQuestion()
  const dismissQuestion = useDismissQuestion()
  const respondApproval = useRespondApproval()
  const keepFocus = () => fieldRef.current?.focus()
  const question = useQuestion(
    request.kind === 'question' ? request : undefined,
    draft,
    update,
    (item, answers, progress) => respondQuestion(botId, item.id, answers, progress),
    (item, progress) => dismissQuestion(botId, item.id, progress),
    keepFocus
  )
  const approval = useApproval(
    request.kind === 'approval' ? request : undefined,
    draft.text,
    (text) => update({ text }),
    (item, decision, note) =>
      respondApproval(botId, item.id, decision === 'once' ? 'allow' : decision, note),
    keepFocus
  )
  const isQuestion = request.kind === 'question'
  function submit() {
    if (isQuestion) question.next()
    else approval.send()
  }
  // As in the thread composer, the request sits on the pill like a tab; inset past its corners.
  return (
    <div className={botAccentClass}>
      <div className='px-5'>
        {isQuestion ? (
          <QuestionStrip item={request} ctl={question} />
        ) : (
          <ApprovalStrip item={request} ctl={approval} typed={!!draft.text.trim()} />
        )}
      </div>
      <div className='flex items-center gap-1.5 rounded-[20px] bg-popover p-1.5 pl-3'>
        <InputGroupTextarea
          ref={fieldRef}
          rows={1}
          value={draft.text}
          placeholder={
            isQuestion
              ? question.spec?.options.length
                ? 'Or type your own answer'
                : 'Type your answer'
              : 'Tell the agent what to do instead'
          }
          onChange={(event) => update({ text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            } else if (
              isQuestion ? question.onKey(event.nativeEvent) : approval.onKey(event.nativeEvent)
            )
              event.preventDefault()
          }}
          className='max-h-48 min-h-0 flex-1 p-0 text-sm md:text-sm'
        />
        <Button
          size='sm'
          className='rounded-full'
          disabled={isQuestion ? !question.answer : !draft.text.trim() && !approval.confirming}
          onClick={submit}
        >
          {isQuestion
            ? question.last
              ? 'Submit'
              : 'Next'
            : approval.confirming
              ? 'Allow always'
              : 'Deny with note'}
        </Button>
      </div>
    </div>
  )
}
