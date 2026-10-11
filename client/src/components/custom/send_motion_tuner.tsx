import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pressProps } from '@/lib/press'
import { setSendMotionMode, useSendMotionMode } from '@/lib/send-motion'

export function SendMotionTuner() {
  const mode = useSendMotionMode()
  return (
    <aside
      aria-label='Echo send motion controls'
      className='fixed bottom-3 left-3 z-50 flex flex-col gap-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md'
    >
      <span className='px-2 text-xs text-muted-foreground'>Echo · Send motion</span>
      <ToggleGroup
        size='sm'
        spacing={1}
        value={[mode]}
        aria-label='Send animation'
        onValueChange={(values) => {
          const value = values[0]
          if (value === 'gentle' || value === 'spring') setSendMotionMode(value)
        }}
      >
        <ToggleGroupItem value='gentle' {...pressProps(() => setSendMotionMode('gentle'))}>
          Gentler start
        </ToggleGroupItem>
        <ToggleGroupItem value='spring' {...pressProps(() => setSendMotionMode('spring'))}>
          Spring settle
        </ToggleGroupItem>
      </ToggleGroup>
    </aside>
  )
}
