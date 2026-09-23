import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { MagnifyingGlassIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'

import type { ThreadGrouping } from './sidebar_thread_groups'

import { GhostInput } from './ghost_input'

export function SidebarThreadControls({
  query,
  onQueryChange,
  grouping,
  onGroupingChange,
  showPinned,
  onShowPinnedChange,
}: {
  query: string
  onQueryChange: (query: string) => void
  grouping: ThreadGrouping
  onGroupingChange: (grouping: ThreadGrouping) => void
  showPinned: boolean
  onShowPinnedChange: (show: boolean) => void
}) {
  return (
    <div className='flex h-7 shrink-0 items-center gap-1 px-2.5'>
      <GhostInput
        icon={<MagnifyingGlassIcon className='size-3' weight='bold' />}
        aria-label='Search threads'
        placeholder='Search threads'
        className='text-xs text-muted-foreground'
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onQueryChange('')
        }}
      />
      <DropdownMenu key={grouping}>
        <DropdownMenuTrigger
          render={
            <Button
              variant='ghost'
              tone='muted'
              size='icon-sm'
              className='-mr-1.5 hover:bg-sidebar-accent'
              aria-label='Thread grouping'
            />
          }
        >
          <SlidersHorizontalIcon className='size-3.5' aria-hidden='true' />
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start' className='w-44'>
          <DropdownMenuRadioGroup
            value={grouping}
            onValueChange={(value) => {
              if (value === 'project' || value === 'status' || value === 'date')
                onGroupingChange(value)
            }}
          >
            <DropdownMenuLabel>Group by</DropdownMenuLabel>
            <DropdownMenuRadioItem value='project'>Project</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value='status'>Status</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value='date'>Date</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
            checked={showPinned}
            onCheckedChange={(checked) => onShowPinnedChange(checked === true)}
            closeOnClick={false}
          >
            Show pinned
            <Switch
              render={<span />}
              size='sm'
              checked={showPinned}
              tabIndex={-1}
              aria-hidden='true'
              className='pointer-events-none ml-auto'
            />
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
