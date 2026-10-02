import type { Attachment } from '@jetty/shared/items'

import { mediaUrl } from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import { cn } from '@/lib/utils'
import { useLayoutEffect, useRef, useState } from 'react'

import { ThreadSourceLabel, type MessageSource } from './source_label'

export const collapsedTextHeight = 240
// Collapsing only pays off when it hides more than a couple of lines.
export const collapseAfterHeight = collapsedTextHeight + 46
// Survives the virtualizer unmounting a row.
export const expandedMessages = new Set<string>()
// Remounts reuse the measurement, so revisiting a thread never forces a synchronous layout. Bounded
// like the code highlight cache, since it holds whole prompts.
export const collapsibleTexts = new Map<string, boolean>()
const fade = 'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)'

export function UserMessage({
  id,
  text,
  attachments,
  from,
}: {
  id: string
  text: string
  attachments: readonly Attachment[]
  from?: MessageSource
}) {
  const openMedia = useOpenMedia()
  const textRef = useRef<HTMLParagraphElement>(null)
  const [collapsible, setCollapsible] = useState(() => collapsibleTexts.get(text) ?? false)
  const [expanded, setExpanded] = useState(() => expandedMessages.has(id))
  useLayoutEffect(() => {
    if (!textRef.current) return
    let measured = collapsibleTexts.get(text)
    if (measured === undefined) {
      measured = textRef.current.scrollHeight > collapseAfterHeight
      if (collapsibleTexts.size >= 512) collapsibleTexts.clear()
      collapsibleTexts.set(text, measured)
    }
    setCollapsible(measured)
  }, [text])
  const collapsed = collapsible && !expanded
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([])
  const images = attachments.filter((attachment) => attachment.mimeType.startsWith('image/'))
  const others = attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'))
  return (
    <Message align='end'>
      <MessageContent className={cn(from && 'gap-1.5')}>
        {from && <ThreadSourceLabel from={from} className='self-end' />}
        <Bubble variant={from ? 'tinted' : 'default'} align='end'>
          <BubbleContent className='rounded-lg'>
            {images.length > 0 && (
              <div className='no-scrollbar scroll-fade-x flex max-w-full gap-2 overflow-x-auto'>
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    ref={(element) => {
                      thumbnails.current[index] = element
                    }}
                    type='button'
                    aria-label={`Open ${image.name}`}
                    className={cn(
                      'shrink-0 cursor-zoom-in rounded-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2',
                      from
                        ? 'focus-visible:outline-ring'
                        : 'focus-visible:outline-primary-foreground'
                    )}
                    onClick={() =>
                      openMedia({
                        items: images,
                        index,
                        origin: (at) => thumbnails.current[at] ?? null,
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
            )}
            {text ? (
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
                {text}
              </p>
            ) : null}
            {collapsible && (
              <Button
                variant='ghost-text'
                size='xs'
                className={cn(
                  '-ml-1 mt-1 px-1',
                  !from &&
                    'text-primary-foreground/85 enabled:hover:text-primary-foreground aria-expanded:text-primary-foreground'
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
                  from ? 'text-muted-foreground' : 'text-primary-foreground/85'
                )}
              >
                {attachment.name}
              </span>
            ))}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
