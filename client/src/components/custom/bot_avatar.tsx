import type { Bot, BotColor } from '@jetty/shared/wire'

import { botFace, type BotFace } from '@jetty/shared/bots'
import { useEffect, useState, type CSSProperties } from 'react'

import type { ThreadStatus } from './thread_status'

import { ErrorBot } from './bot_error_states'
import { JettyBot } from './jetty_bot'
import { botColors, deepBotColors } from './jetty_bot_shapes'

// Done's hops, twinkles and wink, before the face settles back to idle.
const DONE_MS = 1200

// Done plays once when `finished` turns true, then the face settles back to idle.
function useDoneOnce(id: string, finished: boolean) {
  const [prior, setPrior] = useState({ id, finished })
  const [done, setDone] = useState(false)
  if (id !== prior.id || finished !== prior.finished) {
    setPrior({ id, finished })
    // A face that moves to another bot or thread (switching chats) starts over.
    if (id !== prior.id) setDone(false)
    else if (finished) setDone(true)
  }
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), DONE_MS)
    return () => clearTimeout(timer)
  }, [done])
  return done
}

// A bot's face as its state shows it.
export function BotAvatar({
  bot,
  size,
  unread,
  className,
}: {
  bot: Pick<Bot, 'id' | 'shape' | 'color' | 'activity' | 'needsYou' | 'failed' | 'unread'>
  size: number
  unread?: boolean
  className?: string
}) {
  const resting = botFace(bot)
  // A turn that ends with a reply Jett hasn't seen; the unread dot alone keeps saying unseen.
  const done = useDoneOnce(bot.id, bot.unread)
  const face = resting === 'idle' && done ? 'done' : resting
  if (face === 'error')
    return <ErrorBot shape={bot.shape} color={bot.color} size={size} className={className} />
  return (
    <JettyBot
      shape={bot.shape}
      color={bot.color}
      state={face}
      size={size}
      unread={unread ?? bot.unread}
      className={className}
    />
  )
}

const threadFaces: Record<ThreadStatus, BotFace> = {
  working: 'working',
  monitoring: 'working',
  'needs-attention': 'waiting',
  error: 'error',
  idle: 'idle',
  ready: 'idle',
}

// A bot's face showing the state of one of its threads. Finishing plays done once.
export function ThreadFace({
  bot,
  threadId,
  status,
  size,
}: {
  bot: Pick<Bot, 'shape' | 'color'>
  threadId: string
  status: ThreadStatus
  size: number
}) {
  const resting = threadFaces[status]
  const done = useDoneOnce(threadId, resting === 'idle')
  if (resting === 'error') return <ErrorBot shape={bot.shape} color={bot.color} size={size} />
  return (
    <JettyBot
      shape={bot.shape}
      color={bot.color}
      state={resting === 'idle' && done ? 'done' : resting}
      size={size}
    />
  )
}

// The bot's colour as --bot (dark) and --bot-deep (light), for botTextClass and the chat's accent.
export function botColorStyle(color: BotColor) {
  return { '--bot': botColors[color], '--bot-deep': deepBotColors[color] } as CSSProperties
}

// Text in the bot's colour: its deep ink in light, as its face is drawn.
export const botTextClass = 'text-(--bot-deep) dark:text-(--bot)'

// The bot's colour plays the accent inside: bubbles and buttons that fill with primary take it,
// deep with light text in light. Links keep the app's accent, so this never wraps them.
export const botAccentClass =
  '[--primary-foreground:oklch(0.99_0_0)] [--primary:var(--bot-deep)] dark:[--primary-foreground:oklch(0.205_0_0)] dark:[--primary:var(--bot)]'
