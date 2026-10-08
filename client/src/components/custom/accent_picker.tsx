import { accentChangeEvent, accentPresets, loadAccent, setAccent } from '@/lib/accent'
import { useAppearance } from '@/lib/appearance'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

import { DisabledTooltip } from './disabled_tooltip'

function presetAccent() {
  return document.documentElement.dataset.accentFrom === 'wallpaper' ? null : loadAccent()
}

// While the accent comes from the wallpaper, no preset is chosen and the swatches wait.
export function AccentPicker() {
  const { autoAccent } = useAppearance()
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
          <button
            key={preset.value}
            type='button'
            role='radio'
            aria-checked={accent === preset.value}
            aria-label={preset.label}
            disabled={autoAccent}
            onClick={() => setAccent(preset.value)}
            className={cn(
              'flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
              accent === preset.value && 'border-2 border-primary'
            )}
          >
            <span data-accent={preset.value} className='accent-swatch size-3.5 rounded-full' />
          </button>
        ))}
      </div>
    </DisabledTooltip>
  )
}
