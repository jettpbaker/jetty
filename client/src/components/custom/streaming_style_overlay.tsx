import { Button } from '@/components/ui/button'
import { saveStreamingStyle, streamingStyles, useStreamingStyle } from '@/lib/streaming_style'
import { cn } from '@/lib/utils'

// A floating switch for comparing streaming styles on live replies; goes once one is picked.
export function StreamingStyleOverlay() {
  const current = useStreamingStyle()
  return (
    <fieldset
      aria-label='Streaming text'
      className='fixed right-3 bottom-3 z-50 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 text-xs shadow-md'
    >
      <span className='px-1.5 text-muted-foreground'>Streaming</span>
      {streamingStyles.map(({ value, label }) => (
        <Button
          key={value}
          variant='ghost'
          size='xs'
          aria-pressed={value === current}
          onClick={() => saveStreamingStyle(value)}
          className={cn('font-normal', value === current && 'bg-accent text-foreground')}
        >
          {label}
        </Button>
      ))}
    </fieldset>
  )
}
