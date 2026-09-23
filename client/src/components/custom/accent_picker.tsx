import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { accentChangeEvent, accentPresets, isAccent, loadAccent, setAccent } from '@/lib/accent'
import { useAppearance } from '@/lib/appearance'
import { CaretDownIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

function presetAccent() {
  return document.documentElement.dataset.accentFrom === 'wallpaper' ? null : loadAccent()
}

export function AccentPicker() {
  const { autoAccent } = useAppearance()
  const [accent, setAccentState] = useState(presetAccent)

  useEffect(() => {
    const sync = () => setAccentState(presetAccent())
    window.addEventListener(accentChangeEvent, sync)
    return () => window.removeEventListener(accentChangeEvent, sync)
  }, [])

  const label = accent
    ? accentPresets.find((preset) => preset.value === accent)?.label
    : 'From wallpaper'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={autoAccent}
        aria-label={`Accent color: ${label}`}
        render={
          <Button
            variant='ghost'
            size='sm'
            className='h-7 gap-1.5 rounded-sm text-xs text-muted-foreground'
          />
        }
      >
        <span aria-hidden='true' className='size-3 rounded-full bg-primary' />
        {label}
        {accent && <CaretDownIcon aria-hidden='true' className='size-3' />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuRadioGroup
          value={accent ?? ''}
          onValueChange={(value) => {
            if (isAccent(value)) setAccent(value)
          }}
        >
          {accentPresets.map((preset) => (
            <DropdownMenuRadioItem key={preset.value} value={preset.value}>
              <span
                aria-hidden='true'
                data-accent={preset.value}
                className='accent-swatch size-3 rounded-full'
              />
              {preset.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
