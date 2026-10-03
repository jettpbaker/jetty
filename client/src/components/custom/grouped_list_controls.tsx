import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'

import { FilterIcon } from './huge_icons'

type Choice<T extends string> = { value: T; label: string }

export function ListFilterMenu<T extends string>({
  label,
  choices,
  selected,
  onChange,
}: {
  label: string
  choices: readonly Choice<T>[]
  selected: readonly T[]
  onChange: (value: T, checked: boolean) => void
}) {
  const active = selected.length !== choices.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant='ghost-text' tone='muted' size='sm' className='h-7 rounded-sm' />}
      >
        <FilterIcon />
        Filter{active && <span className='size-1 rounded-full bg-primary' />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {choices.map((choice) => (
            <DropdownMenuCheckboxItem
              key={choice.value}
              checked={selected.includes(choice.value)}
              closeOnClick={false}
              onCheckedChange={(checked) => onChange(choice.value, checked)}
            >
              {choice.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
