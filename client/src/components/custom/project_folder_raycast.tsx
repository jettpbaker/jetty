import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ArrowUpLeftIcon, FolderIcon, FolderOpenIcon } from '@phosphor-icons/react'

import { UP, type FolderPicker } from './project_folder_picker'

export function FolderPickerRaycast({ picker }: { picker: FolderPicker }) {
  return (
    <div className='flex flex-col'>
      <div className='flex h-14 items-center gap-3 px-4'>
        <FolderOpenIcon className='size-5 shrink-0 text-muted-foreground' />
        <input
          {...picker.input}
          aria-label='Project folder path'
          value={picker.query}
          onChange={(event) => picker.setQuery(event.target.value)}
          placeholder='Search folders'
          className='h-full w-full bg-transparent text-base outline-hidden placeholder:text-muted-foreground'
        />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- combobox listbox; <select> can't host rich rows */}
      <div {...picker.list} className='h-80 overflow-y-auto overscroll-contain px-2 pb-2'>
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
            <p className='px-3 py-2 text-13 text-muted-foreground'>
              {picker.filter ? 'No matching folders' : 'No folders inside'}
            </p>
          )}
        </div>
      </div>
      <div className='flex h-11 items-center gap-2 rounded-b-xl border-t border-border pr-2 pl-4 text-xs text-muted-foreground'>
        <span className='mr-auto flex items-center gap-1.5'>
          <Kbd>Esc</Kbd>
          Back
        </span>
        <span className='flex items-center gap-1.5 pr-1'>
          {picker.activeIsUp ? 'Go up' : 'Open'}
          <Kbd>↵</Kbd>
        </span>
        <span aria-hidden='true' className='h-4 w-px bg-border' />
        <Button
          variant='ghost-text'
          size='sm'
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

const heading = 'px-3 pt-1 pb-1.5 text-xs font-medium text-muted-foreground'
const row =
  'flex h-10 cursor-default items-center gap-3 rounded-lg px-3 text-13 select-none hover:bg-muted data-[selected=true]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0'
const tag = 'ml-auto pl-4 text-xs text-muted-foreground'
