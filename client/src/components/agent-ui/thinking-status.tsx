import { cn } from '@/lib/utils'
import { Shimmer } from '@/components/ai-elements/shimmer'

// Busy-only status row — not the durable reasoning transcript.
// Pair with Reasoning when the user opts into full chain-of-thought.

export function ThinkingStatus({
  topic,
  className,
}: {
  topic?: string
  className?: string
}) {
  return (
    <output
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm',
        className
      )}
      aria-live='polite'
      aria-label={topic ? `Thinking — ${topic}` : 'Thinking'}
    >
      <Shimmer as='span' className='font-medium text-muted-foreground' duration={1.4}>
        Thinking
      </Shimmer>
      {topic ? (
        <span className='text-muted-foreground/70 transition-opacity duration-300'>{topic}</span>
      ) : null}
    </output>
  )
}
