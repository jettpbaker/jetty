import type { Bot, BotColor } from '@jetty/shared/wire'
import type { CSSProperties } from 'react'

import { botFace } from '@jetty/shared/bots'

import { ErrorBot } from './bot_error_states'
import { JettyBot } from './jetty_bot'
import { botColors, deepBotColors } from './jetty_bot_shapes'

// A bot's face as its state shows it.
export function BotAvatar({
  bot,
  size,
  unread = bot.unread,
  className,
}: {
  bot: Pick<Bot, 'shape' | 'color' | 'activity' | 'needsYou' | 'failed' | 'unread'>
  size: number
  unread?: boolean
  className?: string
}) {
  const face = botFace(bot)
  if (face === 'error')
    return <ErrorBot shape={bot.shape} color={bot.color} size={size} className={className} />
  return (
    <JettyBot
      shape={bot.shape}
      color={bot.color}
      state={face}
      size={size}
      unread={unread}
      className={className}
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
