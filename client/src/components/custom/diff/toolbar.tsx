import { Button } from '@/components/ui/button'
import { Command, CommandInput } from '@/components/ui/command'
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
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { pressProps } from '@/lib/press'
import { useState, useLayoutEffect, type RefObject, type ReactNode } from 'react'

import type { DiffFile } from './model'

import { ChangedFilesTree } from '../changed_files_tree'
import { ArrowDown01Icon, SidebarLeftIcon } from '../huge_icons'
import { Settings2Icon } from '../lucide_icons'

type DiffToggle = readonly [label: string, checked: boolean, set: (checked: boolean) => void]

export function useDiffWrap(view: RefObject<HTMLDivElement | null>) {
  const [narrow, setNarrow] = useState(false)
  const [wrapChoice, setWrapChoice] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    const element = view.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry!.contentRect.width < 720))
    observer.observe(element)
    return () => observer.disconnect()
  }, [view])
  return [wrapChoice ?? narrow, setWrapChoice] as const
}

export function DiffToolbar({
  files,
  total,
  pane,
  paneId,
  onPaneChange,
  filter,
  onFilter,
  inView,
  onSelect,
  diffStyle,
  onDiffStyleChange,
  toggles,
  children,
  filters,
}: {
  files: DiffFile[]
  total: number
  pane: boolean
  paneId: string
  onPaneChange: (pane: boolean) => void
  filter: string
  onFilter: (filter: string) => void
  inView: string | null
  onSelect: (path: string) => void
  diffStyle: 'unified' | 'split'
  onDiffStyleChange: (style: 'unified' | 'split') => void
  toggles: readonly DiffToggle[]
  children?: ReactNode
  filters?: ReactNode
}) {
  return (
    <div className='mx-4 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5'>
      <Button
        variant='ghost'
        size='sm'
        className={`rounded-sm font-normal @max-[720px]:hidden ${pane ? 'bg-accent' : ''}`}
        aria-expanded={pane}
        aria-controls={paneId}
        {...pressProps(() => onPaneChange(!pane))}
      >
        <SidebarLeftIcon className='size-3.5' />
        Files {files.length === total ? files.length : `${files.length} of ${total}`}
      </Button>
      <FilesMenu
        files={files}
        total={total}
        filter={filter}
        onFilter={onFilter}
        inView={inView}
        onSelect={onSelect}
      />
      {children}
      <div className='ml-auto flex items-center gap-1' aria-label='Diff filter'>
        {filters}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                tone='muted'
                size='icon-sm'
                aria-label='Diff display options'
              />
            }
          >
            <Settings2Icon className='size-3.5' aria-hidden='true' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-44'>
            <DropdownMenuRadioGroup
              value={diffStyle}
              onValueChange={(value) => {
                if (value === 'unified' || value === 'split') onDiffStyleChange(value)
              }}
            >
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuRadioItem value='unified'>Unified</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value='split'>Split</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {toggles.map(([label, checked, set]) => (
              <DropdownMenuCheckboxItem
                key={label}
                className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
                checked={checked}
                onCheckedChange={set}
                closeOnClick={false}
              >
                {label}
                <Switch
                  render={<span />}
                  size='sm'
                  checked={checked}
                  tabIndex={-1}
                  aria-hidden='true'
                  className='pointer-events-none ml-auto'
                />
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>{' '}
      </div>
    </div>
  )
}

function treeRows(paths: string[]) {
  const children = new Map<string, Set<string>>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      children.set(parent, (children.get(parent) ?? new Set()).add(parts.slice(0, i + 1).join('/')))
    }
  }
  const files = new Set(paths)
  const folders = [...children.values()].filter(
    (kids) => kids.size > 1 || files.has([...kids][0]!)
  ).length
  return paths.length + folders
}

function FilesMenu({
  files,
  total,
  filter,
  onFilter,
  inView,
  onSelect,
}: {
  files: DiffFile[]
  total: number
  filter: string
  onFilter: (filter: string) => void
  inView: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='rounded-sm font-normal @min-[720px]:hidden'
          />
        }
      >
        Files {files.length === total ? total : `${files.length} of ${total}`}
        <ArrowDown01Icon className='size-3.5 text-muted-foreground' />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='search-picker w-80 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0 ring-border data-open:fade-in-60 data-closed:animate-none'
      >
        <PopoverTitle className='sr-only'>Files</PopoverTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder='Search files'
            aria-label='Search files'
            value={filter}
            onValueChange={onFilter}
          />
        </Command>
        <Separator />
        {/* The tree scrolls inside a fixed height: a row per file and per folder, capped. */}
        <div
          style={{
            height: Math.min(360, treeRows(files.map((f) => f.path)) * 28 + 8),
          }}
        >
          <ChangedFilesTree
            key={files.map((f) => f.path).join()}
            icons='charmed'
            markers='names'
            files={files.map((f) => ({
              path: f.path,
              status: f.status === 'removed' ? 'deleted' : f.status,
            }))}
            counts={Object.fromEntries(
              files.map((f) => [f.path, { additions: f.additions, deletions: f.deletions }])
            )}
            selected={inView}
            onSelect={(path) => {
              setOpen(false)
              onSelect(path)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
