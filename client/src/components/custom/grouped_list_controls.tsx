import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { ListFilterIcon } from './huge_icons'
import { Settings2Icon } from './lucide_icons'

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
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button variant='ghost' size='icon' className='relative' aria-label='Filter' />
              }
            />
          }
        >
          <ListFilterIcon />
          {active && <span className='absolute top-1 right-1 size-1 rounded-full bg-primary' />}
        </TooltipTrigger>
        <TooltipContent>Filter</TooltipContent>
      </Tooltip>
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

export function ListGroupMenu<T extends string>({
  choices,
  value,
  onChange,
}: {
  choices: readonly Choice<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant='ghost' size='icon' aria-label='Group by' />}
            />
          }
        >
          <Settings2Icon />
        </TooltipTrigger>
        <TooltipContent>Group by</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const choice = choices.find((candidate) => candidate.value === next)
            if (choice) onChange(choice.value)
          }}
        >
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
