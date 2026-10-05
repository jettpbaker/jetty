import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTitle } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useFileSearch } from '@/state'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { FileLanguageIcon } from './code_view'
import './option_picker.css'

// Finds a tracked file in the thread's project by fuzzy path, as Cursor's ⌘P does, and opens it.
export function FilePicker({
  projectId,
  threadId,
  anchor,
  open,
  onOpenChange,
  onPick,
}: {
  projectId: string
  threadId: string
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (path: string) => void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchor}
        align='start'
        className='search-picker w-80 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0 ring-border data-open:fade-in-60 data-closed:animate-none'
      >
        <PopoverTitle className='sr-only'>Open file</PopoverTitle>
        <FileResults
          projectId={projectId}
          threadId={threadId}
          onPick={(path) => {
            onOpenChange(false)
            onPick(path)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function FileResults({
  projectId,
  threadId,
  onPick,
}: {
  projectId: string
  threadId: string
  onPick: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const [activeOption, setActiveOption] = useState('')
  const pointerSelection = useRef(false)
  // Each search lists the project's files again, so it waits for a pause in typing.
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 80)
    return () => clearTimeout(timer)
  }, [query])
  const { files, fresh } = useFileSearch(projectId, threadId, search)
  const results = search ? (files ?? []) : []
  // Enter waits for the list that matches what's typed; a click picks what's shown.
  const current = fresh && search === query.trim()
  return (
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
        placeholder='Open file'
        aria-label='Open file'
        value={query}
        onValueChange={setQuery}
      />
      <Separator />
      <CommandList>
        <div className='picker-results'>
          {results.length > 0 ? (
            <CommandGroup>
              {results.map((path) => {
                const name = path.split('/').at(-1) ?? path
                const folder = path.slice(0, -name.length - 1)
                return (
                  <CommandItem
                    key={path}
                    value={`file:${path}`}
                    onSelect={() => {
                      if (current || pointerSelection.current) onPick(path)
                    }}
                  >
                    <FileLanguageIcon path={path} className='size-3 shrink-0' />
                    <span className='shrink-0 font-mono'>{name}</span>
                    {folder && (
                      <span className='min-w-0 truncate font-mono text-muted-foreground'>
                        {folder}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ) : (
            <p className='px-2.5 py-2 text-xs text-muted-foreground'>
              {search && files ? 'No matching files' : 'Type to find a file in this project'}
            </p>
          )}
        </div>
      </CommandList>
    </Command>
  )
}
