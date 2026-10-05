import { Button } from '@/components/ui/button'
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useRef, useState, type ReactNode } from 'react'

import './option_picker.css'

export type PickerOption = {
  value: string
  label: string
  icon?: ReactNode
  hint?: string
}
export type PickerAction = { label: string; icon: ReactNode; onSelect?: () => void }
export type PickerToggle = {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export function OptionPicker({
  name,
  label,
  placeholder,
  icon,
  value,
  options,
  onValueChange,
  align = 'start',
  actions,
  toggle,
  disabled = false,
  emptyLabel = 'Select',
  onOpen,
  className,
  'aria-describedby': describedBy,
}: {
  name: string
  label: string
  placeholder: string
  icon: ReactNode
  value: string
  options: readonly PickerOption[]
  onValueChange: (value: string) => void
  align?: 'start' | 'end'
  actions?: readonly PickerAction[]
  toggle?: PickerToggle
  disabled?: boolean
  onOpen?: () => void
  emptyLabel?: string
  className?: string
  'aria-describedby'?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeOption, setActiveOption] = useState('')
  const pointerSelection = useRef(false)
  const actionChosen = useRef(false)
  const search = query.trim().toLowerCase()
  const results = options.filter((option) => option.label.toLowerCase().includes(search))
  const selected = options.find((option) => option.value === value)

  function select(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuery('')
          onOpen?.()
          actionChosen.current = false
        }
      }}
    >
      <PopoverTrigger
        aria-label={selected ? `${name}: ${selected.label}` : label}
        aria-describedby={describedBy}
        disabled={disabled}
        render={
          <Button
            variant='ghost-text'
            size='sm'
            className={cn('gap-1.5 rounded-sm', disabled && 'pointer-events-none')}
          />
        }
      >
        {selected?.icon ?? icon}
        {selected?.label ?? emptyLabel}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        finalFocus={() => !actionChosen.current}
        className={cn(
          'search-picker w-56 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0 ring-border data-open:fade-in-60 data-closed:animate-none',
          className
        )}
      >
        <PopoverTitle className='sr-only'>{label}</PopoverTitle>
        <Command
          shouldFilter={false}
          value={activeOption}
          onValueChange={setActiveOption}
          onPointerMove={() => {
            pointerSelection.current = true
          }}
          onKeyDown={() => {
            pointerSelection.current = false
          }}
          onPointerLeave={() => {
            if (pointerSelection.current) setActiveOption('')
          }}
        >
          <CommandInput
            placeholder={placeholder}
            aria-label={placeholder}
            value={query}
            onValueChange={setQuery}
          />
          <Separator />
          <CommandList>
            <div className='picker-results'>
              <CommandGroup>
                {results.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`option:${option.value}`}
                    data-checked={option.value === value}
                    onSelect={() => select(() => onValueChange(option.value))}
                  >
                    {option.icon ?? icon}
                    <span className='flex-1 truncate'>{option.label}</span>
                    {option.hint && <span className='text-muted-foreground'>{option.hint}</span>}
                  </CommandItem>
                ))}
                {!results.length && (
                  <p className='px-2 py-2 text-xs text-muted-foreground'>No matches</p>
                )}
              </CommandGroup>
            </div>
            {actions && (
              <>
                <Separator />
                <CommandGroup>
                  {actions.map(({ label, icon, onSelect }) => (
                    <CommandItem
                      key={label}
                      value={`action:${label}`}
                      disabled={!onSelect}
                      onSelect={() => {
                        if (!onSelect) return
                        actionChosen.current = true
                        select(onSelect)
                      }}
                    >
                      {icon}
                      {label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {toggle && (
              <>
                <Separator />
                <CommandGroup>
                  {/* A press toggles on pointer-down; Enter arrives as a select. */}
                  {/* The switch shows the state, so the item's tick column goes. */}
                  <CommandItem
                    value='toggle'
                    aria-checked={toggle.checked}
                    className='[&>svg:last-child]:hidden'
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      pointerSelection.current = true
                      toggle.onCheckedChange(!toggle.checked)
                    }}
                    onSelect={() => {
                      if (!pointerSelection.current) toggle.onCheckedChange(!toggle.checked)
                    }}
                  >
                    <span className='flex-1'>{toggle.label}</span>
                    <Switch
                      render={<span />}
                      size='sm'
                      checked={toggle.checked}
                      tabIndex={-1}
                      aria-hidden='true'
                      className='pointer-events-none'
                    />
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
