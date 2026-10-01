import { Button } from '@/components/ui/button'
import {
  loadLightComposerShadow,
  setLightComposerShadow,
  type LightComposerShadow,
} from '@/lib/composer-shadow-settings'
import { useState } from 'react'

const options: { value: LightComposerShadow; label: string }[] = [
  { value: 'faint', label: 'Fainter' },
  { value: 'tinted', label: 'Fainter + tinted' },
]

// Temporary: a picker for comparing the light-mode composer shadows. Remove once one is chosen.
export function ComposerShadowToggle() {
  const [value, setValue] = useState(loadLightComposerShadow)
  return (
    <div
      role='group'
      aria-label='Composer shadow in light mode'
      className='absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-md border border-border bg-background p-1 text-xs'
    >
      <span className='px-1.5 text-muted-foreground'>Shadow</span>
      {options.map((option) => (
        <Button
          key={option.value}
          variant='ghost'
          size='sm'
          aria-pressed={value === option.value}
          className='h-6 rounded-sm px-2 text-xs aria-pressed:bg-accent aria-pressed:text-foreground'
          onClick={() => {
            setLightComposerShadow(option.value)
            setValue(option.value)
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
