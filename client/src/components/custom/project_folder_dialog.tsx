import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useBrowse } from '@/state'
import { ArrowBendUpLeftIcon, FolderIcon, FolderPlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'

function baseName(path: string) {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

function parentDir(path: string) {
  return path.slice(0, path.lastIndexOf('/')) || '/'
}

export function ProjectFolderDialog({
  open,
  onOpenChange,
  existingPaths,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingPaths: readonly string[]
  onAdd: (path: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
        <FolderBrowser
          existingPaths={existingPaths}
          onAdd={(path) => {
            onAdd(path)
            onOpenChange(false)
          }}
        />
        <div className='flex min-h-12 items-center justify-end border-t border-border px-4 py-3 text-xs text-muted-foreground'>
          <span>
            ↵ Select <span className='ml-3'>Esc Close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FolderBrowser({
  existingPaths,
  onAdd,
}: {
  existingPaths: readonly string[]
  onAdd: (path: string) => void
}) {
  const [query, setQuery] = useState('~/')
  const result = useBrowse(query)
  const candidate = query.trim().replace(/\/+$/, '')
  const siblings = useBrowse(candidate || '/')

  const entries = result?.entries ?? []
  const parent = result?.parentPath
  const addPath = candidate
    ? siblings?.entries.find(
        (entry) => entry.name.toLowerCase() === baseName(candidate).toLowerCase()
      )?.fullPath
    : undefined
  const exists = addPath !== undefined && existingPaths.includes(addPath)

  function drill(path: string) {
    setQuery(path.endsWith('/') ? path : `${path}/`)
  }

  return (
    <Command shouldFilter={false} className='rounded-none! p-2'>
      <CommandInput
        aria-label='Project folder path'
        value={query}
        onValueChange={setQuery}
        placeholder='Enter a project path'
      />
      <CommandList className='max-h-[50vh]'>
        <CommandGroup heading='Folders'>
          {entries.map((entry) => (
            <CommandItem
              key={entry.fullPath}
              value={entry.fullPath}
              onSelect={() => drill(entry.fullPath)}
              className='min-h-[42px] text-xs'
            >
              <FolderIcon className='size-4 text-muted-foreground' />
              <span>{entry.name}</span>
              <span className='ml-auto truncate pl-4 text-muted-foreground'>{entry.fullPath}</span>
            </CommandItem>
          ))}
          {result && entries.length === 0 && (
            <p className='px-2 py-6 text-center text-xs text-muted-foreground'>
              {addPath ? 'No folders inside.' : 'No matching folder.'}
            </p>
          )}
        </CommandGroup>
        <CommandGroup className='border-t border-border'>
          {addPath && (
            <CommandItem
              value='__add__'
              disabled={exists}
              onSelect={() => onAdd(addPath)}
              className='min-h-[42px] text-xs'
            >
              <FolderPlusIcon className='size-4' />
              <span>{exists ? 'Already added' : `Add ${baseName(addPath)}`}</span>
            </CommandItem>
          )}
          {parent && parent !== '/' && (
            <CommandItem
              value='__up__'
              onSelect={() => drill(parentDir(parent))}
              className='min-h-[42px] text-xs'
            >
              <ArrowBendUpLeftIcon className='size-4' />
              Go up
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
