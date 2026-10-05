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
  settings: { hotkey: 'Mod+,', label: '⌘,', name: 'Settings', modifiers: ['Meta'] },
  sidebar: { hotkey: 'Mod+B', label: '⌘B', name: 'Toggle left sidebar', modifiers: ['Meta'] },
  details: {
    hotkey: 'Mod+Alt+B',
    label: '⌥⌘B',
    name: 'Toggle thread details',
    modifiers: ['Alt', 'Meta'],
  },
  pinned: Array.from(
    { length: 9 },
    (_, index): Keybind => ({
      hotkey: { code: `Digit${index + 1}`, alt: true },
      label: `⌥${index + 1}`,
      name: `Open pinned thread ${index + 1}`,
      modifiers: ['Alt'],
    })
  ),
} satisfies Record<string, Keybind | Keybind[]>

const ModifierContext = createContext<Modifier | null>(null)

const modifiers: readonly string[] = ['Meta', 'Alt', 'Shift', 'Control']

// A modifier held on its own for 200ms reveals its chips; any other key (a chord) hides them until the next press.
export function KeybindProvider({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState<Modifier | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function hide() {
      clearTimeout(timer)
      setRevealed(null)
    }
    function keydown(event: KeyboardEvent) {
      if (event.repeat && modifiers.includes(event.key)) return
      hide()
      const held = [event.metaKey, event.altKey, event.shiftKey, event.ctrlKey].filter(
        Boolean
      ).length
      if (modifiers.includes(event.key) && held === 1)
        timer = setTimeout(() => setRevealed(event.key as Modifier), 200)
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('keyup', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('keyup', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])
  return <ModifierContext value={revealed}>{children}</ModifierContext>
}

export function useModifierHeld(binding?: Keybind) {
  const modifier = useContext(ModifierContext)
  return modifier !== null && Boolean(binding?.modifiers.includes(modifier))
}

export function useHeldModifier() {
  return useContext(ModifierContext)
}

const glyphs: Record<Modifier, string> = { Meta: '⌘', Alt: '⌥', Shift: '⇧', Control: '⌃' }

// While its modifier is held, a chip shows only the keys still to press ("1", not "⌥1").
export function KeybindChip({
  binding,
  held = null,
  className,
}: {
  binding: Keybind
  held?: Modifier | null
  className?: string
}) {
  const label =
    held && binding.modifiers.includes(held)
      ? binding.label.replace(glyphs[held], '')
      : binding.label
  return (
    <Kbd
      aria-label={binding.label}
      className={cn(
        'keybind-chip h-4 min-w-4 rounded-[3px] bg-foreground/8 px-1 font-sans text-[10px] font-normal leading-none text-muted-foreground',
        // Kbd clears its fill inside tooltips; a chip keeps it everywhere.
        'in-data-[slot=tooltip-content]:min-w-4 in-data-[slot=tooltip-content]:bg-foreground/8 in-data-[slot=tooltip-content]:px-1',
        className
      )}
    >
      {label}
    </Kbd>
  )
}

export function HoverKeybind({ binding, className }: { binding: Keybind; className?: string }) {
  const held = useHeldModifier()
  const active = held !== null && binding.modifiers.includes(held)
  return (
    <span
      data-keybind-held={active || undefined}
      className={cn('hover-keybind shrink-0', className)}
    >
      <KeybindChip binding={binding} held={held} />
    </span>
  )
}

export function KeybindTooltip({
  binding,
  children,
}: {
  binding: Keybind
  children: ReactElement
}) {
  const held = useModifierHeld(binding)
  const heldModifier = useHeldModifier()
  return (
    <span className='relative inline-flex shrink-0'>
      <Tooltip>
        <TooltipTrigger render={children} />
        <TooltipContent>
          {binding.name}
          <KeybindChip binding={binding} />
        </TooltipContent>
      </Tooltip>
      {held && (
        <KeybindChip
          binding={binding}
          held={heldModifier}
          className='absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2'
        />
      )}
    </span>
  )
}
