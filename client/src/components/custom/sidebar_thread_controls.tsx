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
      <label className='flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground'>
        <span aria-hidden='true' className='flex shrink-0 items-center'>
          <MagnifyingGlassIcon className='size-3' />
        </span>
        <input
          aria-label='Search threads'
          placeholder='Search threads'
          className='h-7 w-full min-w-0 border-0 bg-transparent p-0 text-xs text-muted-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground'
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onQueryChange('')
          }}
        />
      </label>
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
          <DropdownMenuRadioGroup value={grouping} onValueChange={onGroupingChange}>
            <DropdownMenuLabel>Group by</DropdownMenuLabel>
            <DropdownMenuRadioItem value='project'>Project</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value='status'>Status</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value='date'>Date</DropdownMenuRadioItem>
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
