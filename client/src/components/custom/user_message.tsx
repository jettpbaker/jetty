import type { Attachment } from '@jetty/shared/items'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'

export function UserMessage({
  text,
  attachments,
}: {
  text: string
  attachments: readonly Attachment[]
}) {
  return (
    <Message align='end'>
      <MessageContent>
        <Bubble variant='secondary' align='end'>
          <BubbleContent
            className='rounded-lg'
            style={{ backgroundColor: 'oklch(from var(--primary) l c h / 0.25)' }}
          >
            {text ? <p className='leading-relaxed whitespace-pre-wrap'>{text}</p> : null}
            {attachments.length > 0 && (
              <div className='mt-2 flex flex-col gap-2'>
                {attachments.map((attachment) =>
                  attachment.mimeType.startsWith('image/') ? (
                    <img
                      key={attachment.id}
                      src={
                        attachment.id.startsWith('blob:')
                          ? attachment.id
                          : `/attachments/${attachment.id}`
                      }
                      alt={attachment.name}
                      className='max-h-64 rounded-md'
                    />
                  ) : (
                    <span key={attachment.id} className='text-xs text-muted-foreground'>
                      {attachment.name}
                    </span>
                  )
                )}
              </div>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
