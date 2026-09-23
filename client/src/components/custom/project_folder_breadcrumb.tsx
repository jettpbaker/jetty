import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ArrowUpLeftIcon, FolderIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { Fragment } from 'react'

import { UP, type FolderPicker } from './project_folder_picker'

function crumbs(picker: FolderPicker) {
  if (!picker.dir) return []
  const root = picker.dirLabel.startsWith('~') ? (picker.home ?? '/') : '/'
  const rest = picker.dirLabel.replace(/^~?\/?/, '')
  const trail = [{ label: root === '/' ? '/' : '~', path: root }]
  let path = root
  for (const segment of rest ? rest.split('/') : []) {
    path = path === '/' ? `/${segment}` : `${path}/${segment}`
    trail.push({ label: segment, path })
  }
  return trail
}

export function FolderPickerBreadcrumb({ picker }: { picker: FolderPicker }) {
  const trail = crumbs(picker)
  return (
    <div className='flex flex-col'>
      <nav aria-label='Folder path' className='flex h-9 items-center overflow-x-auto px-2 pt-1'>
        {trail.map((crumb, index) => (
          <Fragment key={crumb.path}>
            {index > 0 && trail[index - 1]?.label !== '/' && (
              <span className='px-0.5 text-xs text-muted-foreground'>/</span>
            )}
            <Button
              variant='ghost-text'
              size='xs'
              aria-current={index === trail.length - 1 ? 'page' : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => picker.goTo(crumb.path)}
              className='px-1 text-muted-foreground aria-[current=page]:text-foreground'
            >
              {crumb.label}
            </Button>
          </Fragment>
        ))}
      </nav>
      <div className='flex h-8 items-center gap-2 px-3'>
        <MagnifyingGlassIcon className='size-3.5 shrink-0 text-muted-foreground' />
        <input
          {...picker.input}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !picker.filter && picker.canGoUp) {
              event.preventDefault()
              picker.goUp()
            } else picker.input.onKeyDown(event)
          }}
          aria-label='Filter folders'
          value={picker.filter}
          onChange={(event) => picker.setFilter(event.target.value)}
          placeholder={`Filter ${picker.dir ? picker.dirLabel : 'folders'}`}
          className='h-full w-full bg-transparent text-xs outline-hidden placeholder:text-muted-foreground'
        />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- combobox listbox; <select> can't host rich rows */}
      <div {...picker.list} className='h-64 overflow-y-auto overscroll-contain px-1.5 pt-1 pb-1.5'>
        <div>
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

const row =
  'flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-xs select-none hover:bg-muted data-[selected=true]:bg-accent [&_svg]:size-3.5 [&_svg]:shrink-0'
const tag = 'ml-auto pl-4 text-xs text-muted-foreground'
