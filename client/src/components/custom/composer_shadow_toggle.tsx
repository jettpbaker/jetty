import { Button } from '@/components/ui/button'
import {
  loadComposerShadowLook,
  setComposerShadowLook,
  type ComposerShadowLook,
} from '@/lib/composer-shadow-settings'
import { useState } from 'react'

const techniques: { value: ComposerShadowLook['technique']; label: string }[] = [
  { value: 'gradient', label: 'Gradient' },
  { value: 'blur', label: 'Blur' },
  { value: 'off', label: 'Off' },
]

// Temporary: compares light-mode composer shadows. Remove once one is chosen.
export function ComposerShadowToggle() {
  const [look, setLook] = useState(loadComposerShadowLook)
  function update(next: ComposerShadowLook) {
    setComposerShadowLook(next)
    setLook(next)
  }
  return (
    <fieldset
      aria-label='Composer shadow in light mode'
      className='m-0 flex items-center gap-1 rounded-md border border-border bg-background p-1 text-xs'
    >
      <span className='px-1.5 text-muted-foreground'>Shadow</span>
      {techniques.map((technique) => (
        <Button
          key={technique.value}
          variant='ghost'
          size='sm'
          aria-pressed={look.technique === technique.value}
          className='h-6 rounded-sm px-2 text-xs aria-pressed:bg-accent aria-pressed:text-foreground'
          onClick={() => update({ ...look, technique: technique.value })}
        >
          {technique.label}
        </Button>
      ))}
      <Button
        variant='ghost'
        size='sm'
        aria-pressed={look.tinted}
        className='h-6 rounded-sm px-2 text-xs aria-pressed:bg-accent aria-pressed:text-foreground'
        onClick={() => update({ ...look, tinted: !look.tinted })}
      >
        Tinted
      </Button>
    </fieldset>
  )
}
