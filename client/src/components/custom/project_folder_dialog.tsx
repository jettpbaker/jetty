import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ArrowBendUpLeftIcon, FolderIcon, FolderPlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'

// Design fixtures; the production picker uses Jetty v1's fs.browse endpoint.
const directories: Record<string, string[]> = {
  '~': ['code', 'Desktop', 'Documents', 'Downloads'],
  '~/code': ['jetty', 'scratch', 'wiki'],
  '~/code/scratch': ['jetty-design', 'playground'],
  '~/Documents': ['projects'],
  '~/Documents/projects': ['notes'],
}
const knownFolders = new Set([
  '~',
  ...Object.keys(directories),
  ...Object.entries(directories).flatMap(([parent, children]) =>
    children.map((name) => `${parent}/${name}`)
  ),
])

export function ProjectFolderDialog({
  open,
  onOpenChange,
  existingPaths,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingPaths: string[]
  onAdd: (path: string) => void
}) {
  const [query, setQuery] = useState('~/')
  const trimmed = query.trim().replace(/\/+$/, '')
  const browsing = query.endsWith('/')
  const parent = browsing ? trimmed : trimmed.slice(0, trimmed.lastIndexOf('/')) || '~'
  const filter = browsing ? '' : trimmed.slice(trimmed.lastIndexOf('/') + 1).toLowerCase()
  const entries = (directories[parent] ?? []).filter((name) =>
    name.toLowerCase().startsWith(filter)
  )
  const canAdd = knownFolders.has(trimmed)
  const exists = existingPaths.includes(trimmed)
  function drill(path: string) {
    setQuery(`${path}/`)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery('~/')
      }}
    >
      <DialogContent
        className='gap-0 overflow-hidden rounded-lg p-0 sm:max-w-lg'
        showCloseButton={false}
      >
        <div className='px-4 pt-4 pb-2'>
          <DialogTitle className='text-sm'>New project</DialogTitle>
          <DialogDescription className='sr-only'>
            Browse folders and choose a project directory.
          </DialogDescription>
        </div>
        <Command shouldFilter={false} className='rounded-none! p-2'>
          <CommandInput
            aria-label='Project folder path'
            value={query}
            onValueChange={setQuery}
            placeholder='Enter a project path'
          />
          <CommandList className='max-h-[50vh]'>
            <CommandGroup heading='Folders'>
              {entries.map((name) => (
                <CommandItem
                  key={`${parent}/${name}`}
                  value={`${parent}/${name}`}
                  onSelect={() => drill(`${parent}/${name}`)}
                  className='min-h-[42px] text-xs'
                >
                  <FolderIcon className='size-4 text-muted-foreground' />
                  <span>{name}</span>
                  <span className='ml-auto truncate pl-4 text-muted-foreground'>
                    {parent}/{name}
                  </span>
                </CommandItem>
              ))}
              {entries.length === 0 && (
                <p className='px-2 py-6 text-center text-xs text-muted-foreground'>
                  {canAdd ? 'No folders inside.' : 'No matching folder.'}
                </p>
              )}
            </CommandGroup>
            <CommandGroup className='border-t border-border'>
              {canAdd && (
                <CommandItem
                  value='__add__'
                  disabled={exists}
                  onSelect={() => {
                    onAdd(trimmed)
                    onOpenChange(false)
                    setQuery('~/')
                  }}
                  className='min-h-[42px] text-xs'
                >
                  <FolderPlusIcon className='size-4' />
                  <span>
                    {exists ? 'Already added' : `Add ${trimmed.split('/').pop() || trimmed}`}
                  </span>
                </CommandItem>
              )}
              {parent !== '~' && (
                <CommandItem
                  value='__up__'
                  onSelect={() => drill(parent.slice(0, parent.lastIndexOf('/')) || '~')}
                  className='min-h-[42px] text-xs'
                >
                  <ArrowBendUpLeftIcon className='size-4' />
                  Go up
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className='flex min-h-12 items-center justify-end border-t border-border px-4 py-3 text-xs text-muted-foreground'>
          <span>
            ↵ Select <span className='ml-3'>Esc Close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
