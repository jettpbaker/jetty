import type { Attachment } from '@jetty/shared/items'

import { mediaUrl } from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import { Play } from '@phosphor-icons/react'
import { useRef, useState } from 'react'

function formatDuration(seconds: number) {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function VideoMessage({ video, caption }: { video: Attachment; caption?: string }) {
  const openMedia = useOpenMedia()
  const thumbnail = useRef<HTMLButtonElement>(null)
  const [duration, setDuration] = useState<number>()
  const title = caption || video.name
  const details = [
    duration === undefined ? undefined : formatDuration(duration),
    caption ? video.name : undefined,
  ].filter(Boolean)

  function play() {
    openMedia({ items: [video], index: 0, origin: () => thumbnail.current })
  }

  return (
    <Message align='start'>
      <MessageContent>
        <div className='flex w-full max-w-md items-center gap-3 rounded-lg border bg-card p-2 text-card-foreground'>
          <button
            ref={thumbnail}
            type='button'
            aria-label={`Play ${video.name}`}
            className='relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-black outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
            onClick={play}
          >
            {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a muted poster frame, never played here */}
            <video
              // The fragment makes browsers paint the first frame instead of a black box.
              src={`${mediaUrl(video)}#t=0.001`}
              preload='metadata'
              muted
              playsInline
              tabIndex={-1}
              className='size-full object-contain'
              onDurationChange={({ currentTarget }) => {
                if (Number.isFinite(currentTarget.duration)) setDuration(currentTarget.duration)
              }}
            />
            <span className='absolute inset-0 grid place-items-center'>
              <span className='grid size-8 place-items-center rounded-full bg-black/60 text-white'>
                <Play weight='fill' />
              </span>
            </span>
          </button>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <p className='truncate font-medium'>{title}</p>
            <p className='truncate text-xs text-muted-foreground tabular-nums'>
              {details.join(' · ') || 'Video'}
            </p>
          </div>
          <Button variant='outline' size='sm' className='mr-1' onClick={play}>
            <Play weight='fill' />
            Play
          </Button>
        </div>
      </MessageContent>
    </Message>
  )
}
