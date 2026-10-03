import type { ComponentProps } from 'react'

import {
  ArrowExpand01Icon,
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
} from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

function MediaAction(props: ComponentProps<typeof Button> & { label: string }) {
  const { label, ...rest } = props
  return (
    <Button
      variant='ghost'
      size='icon-sm'
      className='rounded-menu-item hover:bg-white/10 not-disabled:hover:bg-white/10'
      aria-label={label}
      {...rest}
    />
  )
}

// The clipboard takes PNG only, so redraw whatever the image is.
async function copyImage(src: string) {
  const image = new window.Image()
  image.crossOrigin = 'anonymous'
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  canvas.getContext('2d')?.drawImage(image, 0, 0)
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png) return
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  toast('Image copied')
}

// Hover actions over an image or video, on frosted glass rather than a popover surface; `dark` keeps
// its tokens legible on any picture. The parent is a `group/media` with `relative` positioning.
export function MediaActions({
  src,
  name,
  video,
  onExpand,
  onDelete,
  className,
}: {
  src: string
  name: string
  video?: boolean
  onExpand?: () => void
  onDelete?: () => void
  className?: string
}) {
  return (
    <div
      role='presentation'
      className={cn(
        'dark absolute top-2 right-2 flex items-center gap-0.5 rounded-sm bg-black/35 p-0.5 text-foreground opacity-0 backdrop-blur-md backdrop-saturate-150 transition-opacity group-hover/media:opacity-100 focus-within:opacity-100 motion-reduce:transition-none',
        className
      )}
      onMouseDown={(event) => event.preventDefault()}
    >
      {onExpand && (
        <MediaAction label={video ? 'Expand video' : 'View image'} onClick={onExpand}>
          <ArrowExpand01Icon />
        </MediaAction>
      )}
      <MediaAction
        label={video ? 'Download video' : 'Download image'}
        nativeButton={false}
        render={
          <a href={src} download={name} aria-label={video ? 'Download video' : 'Download image'} />
        }
      >
        <Download04Icon />
      </MediaAction>
      {!video && (
        <MediaAction label='Copy image' onClick={() => void copyImage(src)}>
          <Copy01Icon />
        </MediaAction>
      )}
      {onDelete && (
        <>
          <span aria-hidden className='mx-0.5 h-4 w-px bg-white/15' />
          <MediaAction label='Delete attachment' onClick={onDelete}>
            <Delete02Icon />
          </MediaAction>
        </>
      )}
    </div>
  )
}
