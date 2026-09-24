import type { Attachment } from '@jetty/shared/items'

import {
  fittedStyle,
  GALLERY_GAP,
  galleryColumns,
  INLINE_IMAGE_MAX_HEIGHT,
  mediaUrl,
} from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { Message, MessageContent } from '@/components/ui/message'
import { cn } from '@/lib/utils'
import { useRef, type Ref } from 'react'

export function GalleryMessage({
  images,
  caption,
}: {
  images: readonly Attachment[]
  caption?: string
}) {
  const openMedia = useOpenMedia()
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([])
  const single = images.length === 1

  return (
    <Message align='start'>
      <MessageContent>
        <figure className='flex flex-col gap-2'>
          <div
            className={cn(!single && 'grid')}
            style={
              single
                ? undefined
                : {
                    gap: GALLERY_GAP,
                    gridTemplateColumns: `repeat(${galleryColumns(images.length)}, minmax(0, 1fr))`,
                  }
            }
          >
            {images.map((image, index) => (
              <ImageThumbnail
                key={image.id}
                ref={(element) => {
                  thumbnails.current[index] = element
                }}
                image={image}
                cover={!single}
                onOpen={() =>
                  openMedia({
                    items: images,
                    index,
                    origin: (at) => thumbnails.current[at] ?? null,
                  })
                }
              />
            ))}
          </div>
          {caption ? (
            <figcaption className='text-sm text-muted-foreground'>{caption}</figcaption>
          ) : null}
        </figure>
      </MessageContent>
    </Message>
  )
}

export function ImageThumbnail({
  image,
  cover = false,
  ref,
  onOpen,
  onError,
}: {
  image: Attachment
  cover?: boolean
  ref?: Ref<HTMLButtonElement>
  onOpen: () => void
  onError?: () => void
}) {
  return (
    <button
      ref={ref}
      type='button'
      aria-label={`Open ${image.name}`}
      className={cn(
        'block cursor-zoom-in overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        cover ? 'aspect-[4/3]' : 'w-fit max-w-full'
      )}
      style={cover ? undefined : fittedStyle(image, INLINE_IMAGE_MAX_HEIGHT)}
      onClick={onOpen}
    >
      <img
        src={mediaUrl(image)}
        alt={image.name}
        loading='lazy'
        decoding='async'
        draggable={false}
        className={cn(
          !cover && !image.width ? 'max-h-120 max-w-full' : 'size-full',
          cover ? 'object-cover' : 'object-contain'
        )}
        onError={onError}
      />
    </button>
  )
}
