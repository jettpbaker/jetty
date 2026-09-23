import type { Attachment } from '@jetty/shared/items'

import { Message, MessageContent } from '@/components/ui/message'

export function GalleryMessage({
  images,
  caption,
}: {
  images: readonly Attachment[]
  caption?: string
}) {
  return (
    <Message align='start'>
      <MessageContent>
        <figure className='flex max-w-[80%] flex-col gap-2'>
          <div className='grid grid-cols-2 gap-2'>
            {images.map((image) => (
              <img
                key={image.id}
                src={`/attachments/${image.id}`}
                alt={image.name}
                className='max-h-64 w-full rounded-md object-cover'
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
