import type { Attachment } from '@jetty/shared/items'

import { Message, MessageContent } from '@/components/ui/message'

export function VideoMessage({ video, caption }: { video: Attachment; caption?: string }) {
  return (
    <Message align='start'>
      <MessageContent>
        <figure className='flex max-w-[80%] flex-col gap-2'>
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- gallery videos have no caption track; the optional caption is a figcaption */}
          <video
            src={`/attachments/${video.id}`}
            controls
            className='max-h-64 w-full rounded-md'
            preload='metadata'
          >
            {video.name}
          </video>
          {caption ? (
            <figcaption className='text-sm text-muted-foreground'>{caption}</figcaption>
          ) : null}
        </figure>
      </MessageContent>
    </Message>
  )
}
