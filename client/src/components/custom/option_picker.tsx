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
import { cn } from '@/lib/utils'
import { useRef, useState, type ReactNode } from 'react'

import './option_picker.css'

export type PickerOption = { value: string; label: string; icon?: ReactNode }
export type PickerAction = { label: string; icon: ReactNode; onSelect?: () => void }

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
  disabled = false,
  emptyLabel = 'Select',
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
  disabled?: boolean
  emptyLabel?: string
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
        className='search-picker w-56 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0 ring-border data-open:fade-in-60 data-closed:animate-none'
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
                    <span className='truncate'>{option.label}</span>
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
