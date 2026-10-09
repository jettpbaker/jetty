import type { Attachment, Reply } from '@jetty/shared/items'

import { mediaUrl } from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { UserMessageFooter } from '@/components/custom/message_footer'
import { RepliedTo } from '@/components/custom/reply_quote'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import { cn } from '@/lib/utils'
import { useBot, useRequestReveal } from '@/state'
import { useLayoutEffect, useRef, useState } from 'react'

import { botAccentClass, botColorStyle } from './bot_avatar'
import { ThreadSourceLabel, type MessageSource } from './source_label'

export const collapsedTextHeight = 240
// Collapsing only pays off when it hides more than a couple of lines.
export const collapseAfterHeight = collapsedTextHeight + 46
// Survives the virtualizer unmounting a row.
export const expandedMessages = new Set<string>()
// Remounts reuse the measurement, so revisiting a thread never forces a synchronous layout. Bounded
// like the code highlight cache, since it holds whole prompts.
export const collapsibleTexts = new Map<string, { width: number; collapsible: boolean }>()
const fade = 'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)'

function measureCollapsible(element: HTMLElement, text: string) {
  const collapsible = element.scrollHeight > collapseAfterHeight
  if (collapsibleTexts.size >= 512) collapsibleTexts.clear()
  collapsibleTexts.set(text, { width: element.getBoundingClientRect().width, collapsible })
  return collapsible
}

// A sent message's images as thumbnails, each opening the media viewer. Bots' chats show them too.
export function MessageImages({
  images,
  tinted,
}: {
  images: readonly Attachment[]
  tinted?: boolean
}) {
  const openMedia = useOpenMedia()
  const thumbnailsRef = useRef<(HTMLButtonElement | null)[]>([])
  if (images.length === 0) return null
  return (
    <div className='no-scrollbar scroll-fade-x flex max-w-full gap-2 overflow-x-auto'>
      {images.map((image, index) => (
        <button
          key={image.id}
          ref={(element) => {
            thumbnailsRef.current[index] = element
          }}
          type='button'
          aria-label={`Open ${image.name}`}
          className={cn(
            'shrink-0 cursor-zoom-in rounded-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2',
            tinted ? 'focus-visible:outline-ring' : 'focus-visible:outline-primary-foreground'
          )}
          onClick={() =>
            openMedia({
              items: images,
              index,
              origin: (at) => thumbnailsRef.current[at] ?? null,
            })
          }
        >
          <img
            src={mediaUrl(image)}
            alt={image.name}
            decoding='async'
            draggable={false}
            className='size-12 rounded-sm object-cover'
          />
        </button>
      ))}
    </div>
  )
}

export function UserMessage({
  id,
  threadId,
  text,
  skill,
  replyTo,
  attachments,
  from,
  createdAt,
  steered,
  steering,
}: {
  id: string
  threadId: string
  text: string
  skill?: string
  replyTo?: Reply
  attachments: readonly Attachment[]
  from?: MessageSource
  createdAt: number
  steered?: boolean
  steering?: boolean
}) {
  const reveal = useRequestReveal()
  const bot = useBot(from?.threadId)
  // Another thread's message is tinted; Jett's, and a bot's in its colour, are filled.
  const tinted = from && !bot
  const textRef = useRef<HTMLParagraphElement>(null)
  const [collapsible, setCollapsible] = useState(
    () => collapsibleTexts.get(text)?.collapsible ?? false
  )
  const [expanded, setExpanded] = useState(() => expandedMessages.has(id))
  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const cached = collapsibleTexts.get(text)
    if (!cached) {
      setCollapsible(measureCollapsible(element, text))
      return
    }
    setCollapsible(cached.collapsible)
    // Once laid out its width is free to read, and a new one means the cached result is stale.
    const observer = new ResizeObserver(([entry]) => {
      observer.disconnect()
      if (entry!.borderBoxSize[0]!.inlineSize !== cached.width)
        setCollapsible(measureCollapsible(element, text))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])
  const collapsed = collapsible && !expanded
  const images = attachments.filter((attachment) => attachment.mimeType.startsWith('image/'))
  const others = attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'))
  return (
    <Message align='end'>
      <MessageContent className={cn(from ? (bot ? 'gap-1' : 'gap-1.5') : replyTo && 'gap-0.75')}>
        {from && <ThreadSourceLabel from={from} className='self-end' />}
        {replyTo && (
          <RepliedTo text={replyTo.text} onJump={() => reveal(threadId, replyTo.itemId)} />
        )}
        <Bubble
          variant={tinted ? 'tinted' : 'default'}
          align='end'
          className={cn(bot && botAccentClass)}
          style={bot ? botColorStyle(bot.color) : undefined}
        >
          <BubbleContent className='rounded-lg'>
            <MessageImages images={images} tinted={tinted} />
            {text || skill ? (
              <p
                ref={textRef}
                className={cn(
                  'leading-relaxed whitespace-pre-wrap',
                  images.length > 0 && 'mt-2',
                  collapsed && 'overflow-hidden'
                )}
                style={
                  collapsed
                    ? { maxHeight: collapsedTextHeight, maskImage: fade, WebkitMaskImage: fade }
                    : undefined
                }
              >
                {skill ? `/${skill} ${text}` : text}
              </p>
            ) : null}
            {collapsible && (
              <Button
                variant='ghost-text'
                size='xs'
                className={cn(
                  '-ml-1 mt-1 px-1',
                  !tinted &&
                    'text-primary-foreground/85 not-disabled:hover:text-primary-foreground aria-expanded:text-primary-foreground'
                )}
                aria-expanded={expanded}
                onClick={() => {
                  if (expanded) expandedMessages.delete(id)
                  else expandedMessages.add(id)
                  setExpanded(!expanded)
                }}
              >
                {expanded ? 'Show less' : 'Show full message'}
              </Button>
            )}
            {others.map((attachment) => (
              <span
                key={attachment.id}
                className={cn(
                  'mt-2 text-xs',
                  tinted ? 'text-muted-foreground' : 'text-primary-foreground/85'
                )}
              >
                {attachment.name}
              </span>
            ))}
          </BubbleContent>
          <UserMessageFooter
            text={text}
            createdAt={createdAt}
            steered={steered}
            steering={steering}
          />
        </Bubble>
      </MessageContent>
    </Message>
  )
}
