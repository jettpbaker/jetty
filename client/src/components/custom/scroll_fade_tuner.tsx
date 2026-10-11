import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { setScrollFade, useScrollFade } from '@/lib/chat-scroll-fade'
import { pressProps } from '@/lib/press'

export function ScrollFadeTuner() {
  const enabled = useScrollFade()
  return (
    <aside
      aria-label='Echo scroll fade controls'
      className='fixed bottom-3 left-3 z-50 flex flex-col gap-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md'
    >
      <span className='px-2 text-xs text-muted-foreground'>Echo · Top fade · 16px</span>
      <ToggleGroup
        size='sm'
        spacing={1}
        value={[enabled ? 'on' : 'off']}
        aria-label='Top scroll fade'
        onValueChange={(values) => {
          const value = values[0]
          if (value === 'on' || value === 'off') setScrollFade(value === 'on')
        }}
      >
        <ToggleGroupItem value='off' {...pressProps(() => setScrollFade(false))}>
          Off
        </ToggleGroupItem>
        <ToggleGroupItem value='on' {...pressProps(() => setScrollFade(true))}>
          On
        </ToggleGroupItem>
      </ToggleGroup>
    </aside>
  )
}
