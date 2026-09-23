import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ArrowUpLeftIcon, FolderIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'

import { UP, type FolderPicker } from './project_folder_picker'

export function FolderPickerCompact({ picker }: { picker: FolderPicker }) {
  return (
    <div className='flex flex-col'>
      <div className='flex h-10 items-center gap-2 px-3'>
        <MagnifyingGlassIcon className='size-3.5 shrink-0 text-muted-foreground' />
        <input
          {...picker.input}
          aria-label='Project folder path'
          value={picker.query}
          onChange={(event) => picker.setQuery(event.target.value)}
          placeholder='Search folders'
          className='h-full w-full bg-transparent text-13 outline-hidden placeholder:text-muted-foreground'
        />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- combobox listbox; <select> can't host rich rows */}
      <div {...picker.list} className='h-64 overflow-y-auto overscroll-contain px-1.5 pb-1.5'>
        <div>
          <p className={heading}>{picker.dirLabel}</p>
          {picker.canGoUp && (
            <div {...picker.row(UP)} className={row}>
              <ArrowUpLeftIcon className='text-muted-foreground' />
              ..
            </div>
          )}
          {picker.entries.map((entry) => (
            <div key={entry.fullPath} {...picker.row(entry.fullPath)} className={row}>
              <FolderIcon className='text-muted-foreground' />
              <span className='truncate'>{entry.name}</span>
              {(entry.added || entry.isGitRepo) && (
                <span className={tag}>{entry.added ? 'Added' : 'Git repo'}</span>
              )}
            </div>
          ))}
          {picker.loaded && picker.entries.length === 0 && (
            <p className='px-2 py-1.5 text-xs text-muted-foreground'>
              {picker.filter ? 'No matching folders' : 'No folders inside'}
            </p>
          )}
        </div>
      </div>
      <div className='flex h-9 items-center gap-3 rounded-b-xl border-t border-border pr-1.5 pl-3 text-xs text-muted-foreground'>
        <span className='mr-auto flex items-center gap-1'>
          <Kbd>↵</Kbd>
          {picker.activeIsUp ? 'Up' : 'Open'}
          <Kbd className='ml-2'>Esc</Kbd>
          Back
        </span>
        <Button
          variant='ghost-text'
          size='xs'
          disabled={!picker.target || picker.target.added}
          onClick={picker.add}
          className='text-foreground'
        >
          {picker.target?.added ? 'Already added' : `Add ${picker.target?.name ?? 'folder'}`}
          <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </div>
  )
}

const heading = 'px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground'
const row =
  'flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-xs select-none hover:bg-muted data-[selected=true]:bg-accent [&_svg]:size-3.5 [&_svg]:shrink-0'
const tag = 'ml-auto pl-4 text-xs text-muted-foreground'
