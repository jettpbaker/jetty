import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'

import { ArrowDownIcon } from './central_icons'
import { RollingNumber } from './rolling_number'

// How far above the latest message, in screens, the reader has to be before the arrow shows.
export const scrollToBottomAfter = 1.5

// A navigation row above the composer keeps the control clear of the transcript.
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
    <div
      className={cn(
        'mx-auto flex h-10 w-full max-w-[873px] shrink-0 items-center justify-end px-6',
        !shown && 'hidden'
      )}
    >
      <Button
        variant='ghost'
        tone='muted'
        size='sm'
        aria-label={
          messages
            ? `Jump to latest, ${messages} newer ${messages === 1 ? 'message' : 'messages'}`
            : 'Jump to latest'
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
          <span className='inline-flex items-baseline gap-1'>
            <RollingNumber value={messages} className='font-mono' />
            <span>newer {messages === 1 ? 'message' : 'messages'}</span>
          </span>
        ) : (
          <span>Jump to latest</span>
        )}
        {fresh && <Dot className='top-0.5 right-0.5' />}
      </Button>
    </div>
  )
}
