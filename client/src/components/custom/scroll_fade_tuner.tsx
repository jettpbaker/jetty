import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { setScrollFadeMode, useScrollFadeMode } from '@/lib/chat-scroll-fade'
import { pressProps } from '@/lib/press'

export function ScrollFadeTuner() {
  const mode = useScrollFadeMode()
  return (
    <aside
      aria-label='Echo scroll fade controls'
      className='fixed bottom-3 left-3 z-50 flex flex-col gap-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md'
    >
      <span className='px-2 text-xs text-muted-foreground'>Echo · Top fade</span>
      <ToggleGroup
        size='sm'
        spacing={1}
        value={mode ? [mode] : []}
        aria-label='Top scroll fade'
        onValueChange={(values) => {
          const value = values[0]
          if (value === 't3' || value === 'opencode') setScrollFadeMode(value)
        }}
      >
        <ToggleGroupItem value='t3' {...pressProps(() => setScrollFadeMode('t3'))}>
          T3 Code · 24px
        </ToggleGroupItem>
        <ToggleGroupItem value='opencode' {...pressProps(() => setScrollFadeMode('opencode'))}>
          OpenCode · 16px
        </ToggleGroupItem>
      </ToggleGroup>
    </aside>
  )
}
