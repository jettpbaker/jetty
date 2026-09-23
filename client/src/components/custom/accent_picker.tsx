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

function accentLabel(accent: string, fromWallpaper: boolean) {
  if (fromWallpaper) return 'From wallpaper'
  return accentPresets.find((preset) => preset.value === accent)?.label
}

export function AccentPicker() {
  const { autoAccent } = useAppearance()
  const [accent, updateAccent] = useState(loadAccent)
  const [fromWallpaper, setFromWallpaper] = useState(
    () => document.documentElement.dataset.accentFrom === 'wallpaper'
  )

  useEffect(() => {
    function sync() {
      updateAccent(loadAccent())
      setFromWallpaper(document.documentElement.dataset.accentFrom === 'wallpaper')
    }
    window.addEventListener(accentChangeEvent, sync)
    return () => window.removeEventListener(accentChangeEvent, sync)
  }, [])

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={autoAccent}
        aria-label='Accent color'
        render={
          <Button
            variant='ghost'
            size='sm'
            className='h-7 gap-1.5 rounded-sm text-xs text-muted-foreground'
          />
        }
      >
        <span aria-hidden='true' className='size-3 rounded-full bg-primary' />
        {accentLabel(accent, fromWallpaper)}
        {!fromWallpaper && <CaretDownIcon aria-hidden='true' className='size-3' />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuRadioGroup
          value={fromWallpaper ? '' : accent}
          onValueChange={(value) => {
            if (!isAccent(value)) return
            setAccent(value)
            updateAccent(value)
            setFromWallpaper(false)
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
