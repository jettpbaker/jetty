import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'

import { ArrowDownIcon } from './central_icons'
import { RollingNumber } from './rolling_number'

// How far above the latest message, in screens, the reader has to be before the arrow shows.
export const scrollToBottomAfter = 1.5

// Floating over the transcript, so it takes a popover's surface: its fill, a hairline ring and a shadow.
const floating = 'border-0 bg-popover shadow-md ring-1 ring-foreground/10 dark:bg-popover'

// Occasional UI, so a short ease-out fade and scale in, and a quicker fade out. Reduced motion keeps
// only the fade.
const enter =
  'transition-[opacity,scale,translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[shown=false]:pointer-events-none data-[shown=false]:opacity-0 data-[shown=false]:duration-100 motion-reduce:transition-opacity'

function Dot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('absolute size-1.5 rounded-full bg-primary ring-2 ring-popover', className)}
    />
  )
}

// Its parent's bottom edge is the composer's top.
export function ScrollToBottom({
  shown,
  fresh,
  messages,
  onScroll,
}: {
  shown: boolean
  fresh: boolean
  messages?: number
  onScroll: () => void
}) {
  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-3 flex justify-center'>
      <Button
        variant='ghost'
        tone='muted'
        size='sm'
        aria-label={
          messages
            ? `${messages} assistant ${messages === 1 ? 'message' : 'messages'} below. Scroll to the latest message`
            : 'Scroll to the latest message'
        }
        aria-hidden={!shown}
        tabIndex={shown ? undefined : -1}
        data-shown={shown}
        {...pressProps(onScroll)}
        className={cn(
          'pointer-events-auto relative',
          floating,
          enter,
          'data-[shown=false]:scale-90'
        )}
      >
        <ArrowDownIcon data-icon='inline-start' />
        {messages ? (
          <span aria-hidden className='inline-flex items-baseline gap-1'>
            <RollingNumber value={messages} className='font-mono' bidirectional />
            <span>{messages === 1 ? 'message' : 'messages'}</span>
          </span>
        ) : (
          <span>Latest</span>
        )}
        {fresh && <Dot className='top-0.5 right-0.5' />}
      </Button>
    </div>
  )
}
