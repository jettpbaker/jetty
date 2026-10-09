import type { ComposerImage } from '@/hooks/use-image-attachments'
import type { Attachment } from '@jetty/shared/items'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useRef } from 'react'

import { Alert02Icon, Cancel01Icon } from './huge_icons'
import { mediaUrl } from './media_layout'
import { useOpenMedia } from './media_lightbox'

// A hairline inside an image's corners, so a dark screenshot still reads as an object on a dark chat.
function Edge() {
  return (
    <span
      aria-hidden
      className='pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-foreground/10 ring-inset'
    />
  )
}

// Your images in a bot chat: one row of square thumbs above your bubble, "+N" on the fourth past
// four. Each opens the media viewer at itself; "+N" opens it at the fifth.
export function ThumbRow({ images }: { images: readonly Attachment[] }) {
  const openMedia = useOpenMedia()
  const thumbsRef = useRef<(HTMLElement | null)[]>([])
  const shown = images.slice(0, 4)
  const more = images.length - shown.length
  return (
    <div className='flex justify-end gap-1'>
      {shown.map((attachment, index) => {
        const last = more > 0 && index === shown.length - 1
        return (
          <button
            key={attachment.id}
            type='button'
            ref={(element) => {
              thumbsRef.current[index] = element
            }}
            aria-label={last ? `Open ${more + 1} more images` : `Open ${attachment.name}`}
            onClick={() =>
              openMedia({
                items: images,
                index: last ? shown.length : index,
                origin: (at) => thumbsRef.current[Math.min(at, shown.length - 1)] ?? null,
              })
            }
            className='relative size-16 shrink-0 cursor-zoom-in overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
            <img
              src={mediaUrl(attachment)}
              alt={attachment.name}
              decoding='async'
              draggable={false}
              className='size-full object-cover'
            />
            <Edge />
            {last && (
              <span className='absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-medium text-white'>
                +{more}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// The bot composer's staged images in one row of 40px thumbs. One that couldn't be used is ringed
// in red with its reason at the end of the row; it won't send.
export function StagedImages({
  images,
  onRemove,
}: {
  images: readonly ComposerImage[]
  onRemove: (url: string) => void
}) {
  const failed = images.find((image) => image.error)
  return (
    <div className='flex items-center gap-1 px-1 pt-1'>
      {images.map((image) => (
        <span
          key={image.url}
          className={cn(
            'group/image relative size-10 shrink-0 overflow-hidden rounded-lg',
            image.error && 'ring-2 ring-destructive ring-inset'
          )}
        >
          <img
            src={image.url}
            alt={image.name}
            className={cn('size-full object-cover', image.error && 'opacity-40')}
          />
          <Edge />
          {image.error && (
            <span className='absolute inset-0 flex items-center justify-center text-destructive'>
              <Alert02Icon />
            </span>
          )}
          <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgb(0_0_0/0.6),transparent_55%)] opacity-0 transition-opacity group-focus-within/image:opacity-100 group-hover/image:opacity-100 [@media(hover:none)]:opacity-100' />
          <Button
            variant='ghost-text'
            size='icon-xs'
            aria-label={`Remove ${image.name}`}
            className='absolute top-0 right-0 text-white opacity-0 group-focus-within/image:opacity-100 group-hover/image:opacity-100 not-disabled:hover:text-white [@media(hover:none)]:opacity-100'
            onClick={() => onRemove(image.url)}
          >
            <Cancel01Icon />
          </Button>
        </span>
      ))}
      {failed && (
        <span className='ml-auto min-w-0 truncate pr-1 pl-2 text-xs text-destructive'>
          {failed.error}
        </span>
      )}
    </div>
  )
}
