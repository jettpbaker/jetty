import { accentChangeEvent, accentPresets, loadAccent, setAccent } from '@/lib/accent'
import { useAppearance } from '@/lib/appearance'
import { cn } from '@/lib/utils'
import { useEffect, useId, useState } from 'react'

import { DisabledTooltip } from './disabled_tooltip'

function presetAccent() {
  return document.documentElement.dataset.accentFrom === 'wallpaper' ? null : loadAccent()
}

// While the accent comes from the wallpaper, no preset is chosen and the swatches wait.
export function AccentPicker() {
  const { autoAccent } = useAppearance()
  const name = useId()
  const [accent, setAccentState] = useState(presetAccent)

  useEffect(() => {
    const sync = () => setAccentState(presetAccent())
    window.addEventListener(accentChangeEvent, sync)
    return () => window.removeEventListener(accentChangeEvent, sync)
  }, [])

  return (
    <DisabledTooltip
      reason={autoAccent ? 'Matching the wallpaper' : undefined}
      wrap='flex shrink-0'
    >
      <div role='radiogroup' aria-label='Accent' className='flex shrink-0 items-center gap-1.5'>
        {accentPresets.map((preset) => (
          <label key={preset.value} className='relative'>
            <input
              type='radio'
              name={name}
              value={preset.value}
              aria-label={preset.label}
              checked={accent === preset.value}
              disabled={autoAccent}
              onChange={() => setAccent(preset.value)}
              className='peer sr-only'
            />
            <span
              className={cn(
                'flex size-6 cursor-pointer items-center justify-center rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                accent === preset.value && 'border-2 border-primary'
              )}
            >
              <span data-accent={preset.value} className='accent-swatch size-3.5 rounded-full' />
            </span>
          </label>
        ))}
      </div>
    </DisabledTooltip>
  )
}
