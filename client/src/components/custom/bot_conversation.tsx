import type { Bot, BotConversationMessage } from '@jetty/shared/wire'

import { BotAvatar, botColorStyle, botTextClass } from '@/components/custom/bot_avatar'
import { ArrowDataTransferHorizontalIcon, Cancel01Icon } from '@/components/custom/huge_icons'
import { JettyBot } from '@/components/custom/jetty_bot'
import { Markdown } from '@/components/custom/markdown'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { chatStamp, SESSION_GAP } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useBot, useBotConversation, useBots, useThread } from '@/state'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { exchangeEntry, type ExchangeEntry } from '@jetty/shared/bots'
import { Fragment, useLayoutEffect, useRef, useState, type UIEvent } from 'react'

// A conversation to open over the chat, at the message to bring into view.
export type Room = { botId: string; messageId?: string; at: number }

// px from the bottom that still counts as at it; in a column-reverse scroller, 0 is the bottom.
const PIN_SLACK = 8
// The conversation's padding, which its edges fade across as it scrolls under them.
const EDGE = 24
const EDGE_MASK = `linear-gradient(to bottom, transparent, #000 ${EDGE}px, #000 calc(100% - ${EDGE}px), transparent)`

const nameLinkClass =
  'inline-flex items-center gap-1 rounded-sm outline-none decoration-current/40 underline-offset-[3px] hover:underline focus-visible:ring-2 focus-visible:ring-ring/50'

// The bots' messages since the chat last showed anything else, as one line that counts them.
// Click, not pointer-down: the line sits in a scrollable chat and opens a modal.
export function ExchangeLine({
  chatBotId,
  entries,
  onOpen,
}: {
  chatBotId: string
  entries: readonly ExchangeEntry[]
  onOpen: (room: Room) => void
}) {
  const others: string[] = []
  for (const entry of entries) if (!others.includes(entry.botId)) others.push(entry.botId)
  function open(botId: string) {
    const first = entries.find((entry) => entry.botId === botId)!
    onOpen({ botId, messageId: first.messageId, at: first.at })
  }
  const only = entries.length === 1 ? entries[0] : undefined
  return (
    <div className='flex min-w-0 items-center justify-center gap-[5px] py-0.5 text-xs text-muted-foreground'>
      <span>
        {only ? (only.sent ? 'Messaged' : 'Message from') : `${entries.length} messages with`}
      </span>
      {others.length > 2 ? (
        <RoomsMenu others={others} entries={entries} onOpen={open} />
      ) : (
        others.map((botId, index) => (
          <Fragment key={botId}>
            {index > 0 && <span>and</span>}
            <RoomLink
              chatBotId={chatBotId}
              botId={botId}
              version={entries.findLast((entry) => entry.botId === botId)!.id}
              onOpen={() => open(botId)}
            />
          </Fragment>
        ))
      )}
    </div>
  )
}

function RoomLink({
  chatBotId,
  botId,
  version,
  onOpen,
}: {
  chatBotId: string
  botId: string
  version: string
  onOpen: () => void
}) {
  const bot = useBot(botId)
  // Fetched while the line is on screen, so the conversation opens on it.
  useBotConversation(chatBotId, botId, version)
  if (!bot) return null
  return (
    <button
      type='button'
      onClick={onOpen}
      style={botColorStyle(bot.color)}
      className={cn(nameLinkClass, botTextClass)}
    >
      <BotAvatar bot={bot} size={14} unread={false} />
      {bot.name}
    </button>
  )
}

function RoomsMenu({
  others,
  entries,
  onOpen,
}: {
  others: readonly string[]
  entries: readonly ExchangeEntry[]
  onOpen: (botId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const all = useBots()
  const bots = others.flatMap((id) => all.find((bot) => bot.id === id) ?? [])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(nameLinkClass, 'text-foreground')}>
        <span className='flex'>
          {bots.slice(0, 3).map((bot, index) => (
            <JettyBot
              key={bot.id}
              shape={bot.shape}
              color={bot.color}
              size={14}
              outlined
              className={index ? '-ml-1.5' : undefined}
            />
          ))}
        </span>
        {others.length} bots
      </PopoverTrigger>
      <PopoverContent
        align='start'
        alignOffset={-12}
        sideOffset={8}
        className='w-50 gap-0 rounded-sm p-1'
      >
        <PopoverTitle className='sr-only'>Conversations</PopoverTitle>
        {bots.map((bot) => (
          <button
            key={bot.id}
            type='button'
            onClick={() => {
              setOpen(false)
              onOpen(bot.id)
            }}
            className='flex h-7.5 w-full min-w-0 items-center gap-2 rounded-menu-item px-2 text-xs text-foreground outline-none hover:bg-accent focus-visible:bg-accent'
          >
            <BotAvatar bot={bot} size={16} unread={false} />
            <span className='min-w-0 flex-1 truncate text-left'>{bot.name}</span>
            <span className='shrink-0 font-mono text-muted-foreground'>
              {entries.filter((entry) => entry.botId === bot.id).length}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

type Group = { key: string } & (
  | { stamp: number }
  | { from: string; messages: BotConversationMessage[] }
)

function toGroups(messages: readonly BotConversationMessage[]) {
  const groups: Group[] = []
  let previous: BotConversationMessage | undefined
  for (const message of messages) {
    const last = groups.at(-1)
    if (previous && message.createdAt - previous.createdAt > SESSION_GAP)
      groups.push({ key: `stamp-${message.id}`, stamp: message.createdAt })
    else if (last && 'from' in last && last.from === message.from) {
      last.messages.push(message)
      previous = message
      continue
    }
    groups.push({ key: message.id, from: message.from, messages: [message] })
    previous = message
  }
  return groups
}

// The two bots' whole conversation over the chat, read-only: only they post in it. The chat's own
// bot is on the right.
export function BotConversation({
  bot,
  room,
  host,
  onClose,
}: {
  bot: Bot
  room: Room
  host: HTMLElement | null
  onClose: () => void
}) {
  const other = useBot(room.botId)
  const items = useThread(bot.id)?.items
  const partner = new Set([room.botId])
  const latest = items?.findLast((item) => exchangeEntry(item, partner))?.id
  // A reply can wait in this bot's queue until its turn ends; the other bot finishing its turn
  // is the cue to look again.
  const messages = useBotConversation(bot.id, room.botId, `${latest}:${other?.activity}`)
  const [now] = useState(() => Date.now())
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pressedRef = useRef(false)
  const focusedRef = useRef(false)
  const pinnedRef = useRef(true)
  // Opens on the line's first message; after that, a reader at the bottom sees new ones land.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !messages?.length) return
    if (focusedRef.current) {
      if (pinnedRef.current) scroller.scrollTop = 0
      return
    }
    focusedRef.current = true
    const target = room.messageId
      ? scroller.querySelector(`[data-message="${room.messageId}"]`)?.closest('[data-group]')
      : null
    if (target)
      scroller.scrollTop +=
        target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - EDGE
    pinnedRef.current = scroller.scrollTop > -PIN_SLACK
  }, [messages, room.messageId])
  if (!other) return null
  // Only a press that starts and ends on the backdrop closes, so selecting text never does.
  const backdrop = (event: UIEvent) =>
    event.target === event.currentTarget || event.target === scrollerRef.current
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} modal='trap-focus'>
      <DialogPortal container={host}>
        <DialogPrimitive.Popup
          initialFocus={scrollerRef}
          onPointerDown={(event) => {
            pressedRef.current = backdrop(event)
          }}
          onClick={(event) => {
            if (pressedRef.current && backdrop(event)) onClose()
          }}
          className='absolute inset-0 z-50 flex flex-col items-center bg-background/85 pt-7 pb-6 outline-none backdrop-blur-[8px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none dark:bg-black/62'
        >
          <DialogTitle className='sr-only'>
            {bot.name} and {other.name}
          </DialogTitle>
          <div className='flex items-center gap-2.5'>
            <div className='flex h-7 items-center gap-1.5 rounded-[14px] bg-muted pr-[11px] pl-[7px] text-xs font-medium'>
              <BotAvatar bot={bot} size={16} unread={false} />
              {bot.name}
              <ArrowDataTransferHorizontalIcon className='size-3 -scale-x-100 text-muted-foreground' />
              <BotAvatar bot={other} size={16} unread={false} />
              {other.name}
            </div>
            <span className='text-xs text-muted-foreground'>
              {chatStamp(messages?.[0]?.createdAt ?? room.at, now)}
            </span>
          </div>
          <div
            ref={scrollerRef}
            tabIndex={-1}
            onScroll={({ currentTarget }) => {
              pinnedRef.current = currentTarget.scrollTop > -PIN_SLACK
            }}
            className='scrollbar-subtle flex min-h-0 w-full flex-1 flex-col-reverse overflow-y-auto px-6 outline-none'
            style={{ maskImage: EDGE_MASK }}
          >
            <div className='mx-auto flex min-h-full w-full max-w-[620px] shrink-0 flex-col justify-center gap-4 py-6'>
              {toGroups(messages ?? []).map((group) =>
                'stamp' in group ? (
                  <div key={group.key} className='text-center text-xs text-muted-foreground'>
                    {chatStamp(group.stamp, now)}
                  </div>
                ) : (
                  <SenderGroup
                    key={group.key}
                    bot={group.from === bot.id ? bot : other}
                    own={group.from === bot.id}
                    messages={group.messages}
                  />
                )
              )}
            </div>
          </div>
          <DialogClose
            render={
              <Button
                variant='secondary'
                size='sm'
                className='h-8 gap-1.5 rounded-full bg-popover pr-3.5 pl-3 text-[13px] ring-1 ring-foreground/10'
              />
            }
          >
            <Cancel01Icon />
            Close chat
          </DialogClose>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}

function SenderGroup({
  bot,
  own,
  messages,
}: {
  bot: Bot
  own: boolean
  messages: readonly BotConversationMessage[]
}) {
  return (
    <div
      data-group
      className={cn('flex flex-col gap-1', own ? 'items-end' : 'items-start')}
      style={botColorStyle(bot.color)}
    >
      <span className={cn('px-[34px] text-xs font-medium', botTextClass)}>{bot.name}</span>
      <div className={cn('flex max-w-full items-end gap-1.5', own && 'flex-row-reverse')}>
        <JettyBot shape={bot.shape} color={bot.color} size={22} />
        <div className={cn('flex min-w-0 flex-col gap-[3px]', own ? 'items-end' : 'items-start')}>
          {messages.map((message) => (
            <Bubble
              key={message.id}
              data-message={message.id}
              variant='muted'
              align={own ? 'end' : 'start'}
              className={cn(
                'max-w-[440px] has-[pre,table]:max-w-full',
                own && '*:data-[slot=bubble-content]:bg-accent'
              )}
            >
              <BubbleContent className='bot-reply rounded-[18.5px] border-0 leading-normal'>
                <Markdown>{message.text}</Markdown>
              </BubbleContent>
            </Bubble>
          ))}
        </div>
      </div>
    </div>
  )
}
