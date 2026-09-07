import type { ThreadItem } from '@jetty/shared/items'

import { ImagePreviewDialog, type ImagePreview } from '@/components/image-preview-dialog'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export function ImageGallery({ item }: { item: Extract<ThreadItem, { kind: 'image_gallery' }> }) {
  const [preview, setPreview] = useState<ImagePreview | null>(null)
  const count = item.images.length

  return (
    <div>
      <div
        className={cn(
          count === 2 && 'grid grid-cols-2 gap-2',
          count === 3 && 'grid grid-cols-3 gap-2',
          count === 4 && 'grid grid-cols-2 gap-2'
        )}
      >
        {item.images.map((img) => (
          <button
            key={img.id}
            type='button'
            className={cn(
              'cursor-zoom-in bg-transparent p-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              count === 1
                ? 'inline-block max-w-full rounded-md'
                : 'aspect-[4/3] overflow-hidden rounded-md border bg-muted'
            )}
            onClick={() => setPreview({ url: `/attachments/${img.id}`, name: img.name })}
          >
            <img
              src={`/attachments/${img.id}`}
              alt={img.name}
              title={img.name}
              loading='lazy'
              className={
                count === 1
                  ? 'max-h-80 max-w-full rounded-md border object-contain'
                  : 'size-full object-contain'
              }
            />
          </button>
        ))}
      </div>
      {item.caption ? <p className='mt-2 text-sm text-muted-foreground'>{item.caption}</p> : null}
      <ImagePreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
