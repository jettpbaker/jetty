import type { RegisterableHotkey } from '@tanstack/react-hotkeys'

import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import './keybinds.css'

type Modifier = 'Meta' | 'Alt' | 'Shift' | 'Control'
export type Keybind = {
  hotkey: RegisterableHotkey
  label: string
  name: string
  modifiers: readonly Modifier[]
}

export const keybinds = {
  newThread: {
    hotkey: 'Mod+Shift+O',
    label: '⌘⇧O',
    name: 'New thread',
    modifiers: ['Meta', 'Shift'],
  },
  settings: { hotkey: 'Mod+,', label: '⌘,', name: 'Settings', modifiers: ['Meta'] },
  sidebar: { hotkey: 'Mod+B', label: '⌘B', name: 'Toggle left sidebar', modifiers: ['Meta'] },
  details: {
    hotkey: 'Mod+Alt+B',
    label: '⌥⌘B',
    name: 'Toggle thread details',
    modifiers: ['Alt', 'Meta'],
  },
  pin: { hotkey: 'Mod+Alt+P', label: '⌥⌘P', name: 'Pin thread', modifiers: ['Alt', 'Meta'] },
  model: { hotkey: 'Mod+Alt+M', label: '⌥⌘M', name: 'Model', modifiers: ['Alt', 'Meta'] },
  effort: { hotkey: 'Mod+Alt+E', label: '⌥⌘E', name: 'Effort', modifiers: ['Alt', 'Meta'] },
  access: { hotkey: 'Mod+Alt+A', label: '⌥⌘A', name: 'Access mode', modifiers: ['Alt', 'Meta'] },
  threads: Array.from(
    { length: 9 },
    (_, index): Keybind => ({
      hotkey: { code: `Digit${index + 1}`, alt: true },
      label: `⌥${index + 1}`,
      name: `Open thread ${index + 1}`,
      modifiers: ['Alt'],
    })
  ),
} satisfies Record<string, Keybind | Keybind[]>

// Keys typed into a text field stay there, except in the composer.
export function typingOutsideComposer(event: KeyboardEvent) {
  const field = event.target
  return (
    field instanceof HTMLElement &&
    (field.isContentEditable || field.matches('input, textarea, select')) &&
    !field.closest('[data-perf-region="composer"]')
  )
}

type Held = readonly Modifier[]

const ModifierContext = createContext<Held>([])

const modifiers: readonly string[] = ['Meta', 'Alt', 'Shift', 'Control']

function heldModifiers(event: KeyboardEvent) {
  const held: Modifier[] = []
  if (event.metaKey) held.push('Meta')
  if (event.altKey) held.push('Alt')
  if (event.shiftKey) held.push('Shift')
  if (event.ctrlKey) held.push('Control')
  return held
}

function matches(binding: Keybind | undefined, held: Held) {
  return (
    held.length > 0 && !!binding && held.every((modifier) => binding.modifiers.includes(modifier))
  )
}

// Modifiers held for 200ms reveal the chips of every binding that uses them all, and adding or
// releasing one updates them at once; any other key (a chord) hides them until all are released.
export function KeybindProvider({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState<Held>([])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let shown = false
    let chorded = false
    function reveal(held: Held) {
      clearTimeout(timer)
      // Plain typing reaches here on every key; nothing to hide, so no render.
      if (!held.length && !shown) return
      shown = held.length > 0
      setRevealed(held)
    }
    function track(event: KeyboardEvent) {
      const held = heldModifiers(event)
      if (!held.length) chorded = false
      if (!held.length || chorded) return reveal([])
      if (shown) return reveal(held)
      clearTimeout(timer)
      timer = setTimeout(() => reveal(held), 200)
    }
    function keydown(event: KeyboardEvent) {
      if (modifiers.includes(event.key)) {
        if (!event.repeat) track(event)
        return
      }
      chorded = true
      reveal([])
    }
    function blur() {
      chorded = false
      reveal([])
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('keyup', track, true)
    window.addEventListener('blur', blur)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('keyup', track, true)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return <ModifierContext value={revealed}>{children}</ModifierContext>
}

export function useHeldModifiers() {
  return useContext(ModifierContext)
}

const glyphs: Record<Modifier, string> = { Meta: '⌘', Alt: '⌥', Shift: '⇧', Control: '⌃' }

// While modifiers are held, a chip shows only the keys still to press ("1", not "⌥1").
export function KeybindChip({
  binding,
  held = [],
  className,
}: {
  binding: Keybind
  held?: Held
  className?: string
}) {
  const label = held.reduce(
    (label, modifier) =>
      binding.modifiers.includes(modifier) ? label.replace(glyphs[modifier], '') : label,
    binding.label
  )
  return (
    <Kbd
      aria-label={binding.label}
      className={cn(
        'keybind-chip h-4 min-w-4 gap-0 rounded-[3px] bg-foreground/8 px-1 font-sans text-[10px] font-normal leading-none text-muted-foreground',
        // Kbd clears its fill inside tooltips; a chip keeps it everywhere.
        'in-data-[slot=tooltip-content]:min-w-4 in-data-[slot=tooltip-content]:bg-foreground/8 in-data-[slot=tooltip-content]:px-1',
        className
      )}
    >
      {/* One fixed cell per key, like a macOS menu, so ⌥⌘M and ⌥⌘E are the same width. */}
      {[...label].map((key, index) => (
        <span key={index} className='inline-block min-w-[0.9em] text-center'>
          {key}
        </span>
      ))}
    </Kbd>
  )
}

export function HoverKeybind({ binding, className }: { binding: Keybind; className?: string }) {
  const held = useHeldModifiers()
  return (
    <span
      data-keybind-held={matches(binding, held) || undefined}
      className={cn('hover-keybind shrink-0', className)}
    >
      <KeybindChip binding={binding} held={held} />
    </span>
  )
}

// While its modifiers are held, the chip covers `children` (a row's status glyph).
export function HeldKeybind({ binding, children }: { binding?: Keybind; children: ReactNode }) {
  const held = useHeldModifiers()
  const active = binding && matches(binding, held)
  return (
    <span className='relative flex shrink-0 items-center justify-end'>
      <span className={cn('flex', active && 'invisible')}>{children}</span>
      {active && <KeybindChip binding={binding} held={held} className='absolute right-0' />}
    </span>
  )
}

// While every modifier is held, `children` (a control's icon) becomes the one key left to press.
export function KeybindIcon({ binding, children }: { binding: Keybind; children: ReactNode }) {
  const held = useHeldModifiers()
  return held.length === binding.modifiers.length && matches(binding, held) ? (
    <KeybindChip binding={binding} held={held} />
  ) : (
    children
  )
}

export function KeybindTooltip({
  binding,
  children,
}: {
  binding: Keybind
  children: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        {binding.name}
        <KeybindChip binding={binding} />
      </TooltipContent>
    </Tooltip>
  )
}
