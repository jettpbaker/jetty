import type { Attachment } from '@jetty/shared/items'

import { mediaUrl } from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { cn } from '@/lib/utils'
import { useRef } from 'react'

import { ThreadSourceLabel, type MessageSource } from './source_label'

export function UserMessage({
  text,
  attachments,
  from,
}: {
  text: string
  attachments: readonly Attachment[]
  from?: MessageSource
}) {
  const openMedia = useOpenMedia()
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([])
  const images = attachments.filter((attachment) => attachment.mimeType.startsWith('image/'))
  const others = attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'))
  return (
    <Message align='end'>
      <MessageContent className={cn(from && 'gap-1.5')}>
        {from && <ThreadSourceLabel from={from} className='self-end' />}
        <Bubble variant='secondary' align='end'>
          <BubbleContent
            className='rounded-lg'
            style={
              from ? undefined : { backgroundColor: 'oklch(from var(--primary) l c h / 0.25)' }
            }
          >
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
                    className='shrink-0 cursor-zoom-in rounded-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
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
              <p className={cn('leading-relaxed whitespace-pre-wrap', images.length > 0 && 'mt-2')}>
                {text}
              </p>
            ) : null}
            {others.map((attachment) => (
              <span key={attachment.id} className='mt-2 text-xs text-muted-foreground'>
                {attachment.name}
              </span>
            ))}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
