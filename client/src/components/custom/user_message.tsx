import type { Attachment } from '@jetty/shared/items'

import { BUBBLE_IMAGE_MAX_HEIGHT, fittedStyle, mediaUrl } from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { useRef } from 'react'

export function UserMessage({
  text,
  attachments,
}: {
  text: string
  attachments: readonly Attachment[]
}) {
  const openMedia = useOpenMedia()
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([])
  const images = attachments.filter((attachment) => attachment.mimeType.startsWith('image/'))
  const others = attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'))
  return (
    <Message align='end'>
      <MessageContent>
        <Bubble variant='secondary' align='end'>
          <BubbleContent
            className='rounded-lg'
            style={{ backgroundColor: 'oklch(from var(--primary) l c h / 0.25)' }}
          >
            {text ? <p className='leading-relaxed whitespace-pre-wrap'>{text}</p> : null}
            {images.length > 0 && (
              <div className='mt-2 flex flex-col gap-2'>
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    ref={(element) => {
                      thumbnails.current[index] = element
                    }}
                    type='button'
                    aria-label={`Open ${image.name}`}
                    className='block w-fit max-w-full cursor-zoom-in overflow-hidden rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
                    style={fittedStyle(image, BUBBLE_IMAGE_MAX_HEIGHT)}
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
                      loading='lazy'
                      decoding='async'
                      draggable={false}
                      className={image.width ? 'size-full' : 'max-h-64 max-w-full'}
                    />
                  </button>
                ))}
              </div>
            )}
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
