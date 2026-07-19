import type { Attachment } from '@jetty/shared/items'

import { buildScrollFadeMask, useScrollEdges } from '@/lib/scroll-fade'
import { useRef } from 'react'

const FADE_PX = 24

/**
 * Full-width bordered card; long messages cap at a fixed height and scroll
 * inside, with edges fading only when content is hidden past them.
 */
export function UserMessage({ text, attachments }: { text: string; attachments: Attachment[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef)
  const maskImage = buildScrollFadeMask({ ...edges, topPx: FADE_PX, bottomPx: FADE_PX })

  return (
    <div className='w-full rounded-lg border bg-card px-3 py-2 text-sm'>
      {attachments.length > 0 && (
        <div className='mb-2 flex flex-wrap gap-2'>
          {attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={`/attachments/${attachment.id}`}
              target='_blank'
              rel='noreferrer'
            >
              <img
                src={`/attachments/${attachment.id}`}
                alt={attachment.name}
                loading='lazy'
                className='max-h-32 rounded-md border'
              />
            </a>
          ))}
        </div>
      )}
      {text && (
        <div
          ref={scrollRef}
          style={{ maskImage }}
          className='max-h-24 overflow-y-auto whitespace-pre-wrap'
        >
          {text}
        </div>
      )}
    </div>
  )
}
