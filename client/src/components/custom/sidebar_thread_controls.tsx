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

const groupings: Record<ThreadGrouping, string> = {
  project: 'Project',
  status: 'Status',
  date: 'Date',
}

export function SidebarThreadControls({
  query,
  onQueryChange,
  grouping,
  onGroupingChange,
  showPinned,
  onShowPinnedChange,
  showArchived,
  onShowArchivedChange,
}: {
  query: string
  onQueryChange: (query: string) => void
  grouping: ThreadGrouping
  onGroupingChange: (grouping: ThreadGrouping) => void
  showPinned: boolean
  onShowPinnedChange: (show: boolean) => void
  showArchived: boolean
  onShowArchivedChange: (show: boolean) => void
}) {
  return (
    <div className='flex h-7 shrink-0 items-center gap-1 px-2.5'>
      <GhostInput
        icon={<MagnifyingGlassIcon className='size-3' />}
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
              aria-label={`Thread grouping: ${groupings[grouping]}`}
            />
          }
        >
          <SlidersHorizontalIcon className='size-3.5' aria-hidden='true' />
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start' className='w-44'>
          <DropdownMenuRadioGroup value={grouping} onValueChange={onGroupingChange}>
            <DropdownMenuLabel>Group by</DropdownMenuLabel>
            {Object.entries(groupings).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
            checked={showPinned}
            onCheckedChange={onShowPinnedChange}
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
          <DropdownMenuCheckboxItem
            className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
            checked={showArchived}
            onCheckedChange={onShowArchivedChange}
            closeOnClick={false}
          >
            Show archived
            <Switch
              render={<span />}
              size='sm'
              checked={showArchived}
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
