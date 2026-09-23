import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { ArrowUpLeftIcon, FolderIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { useImperativeHandle, useRef, type RefObject, type UIEvent } from 'react'

import { UP, useFolderPicker } from './project_folder_picker'

function pickerInput() {
  return document.querySelector<HTMLElement>('[data-slot=folder-picker-input]')
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
  const back = useRef<() => boolean>(() => false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === 'escape-key' && back.current()) {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        className='top-[18%] translate-y-0 gap-0 rounded-xl p-0 sm:max-w-2xl'
        showCloseButton={false}
        initialFocus={pickerInput}
      >
        <DialogTitle className='sr-only'>New project</DialogTitle>
        <DialogDescription className='sr-only'>
          Browse folders and choose a project directory.
        </DialogDescription>
        <FolderPicker
          back={back}
          existingPaths={existingPaths}
          onAdd={(path) => {
            onAdd(path)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function FolderPicker({
  back,
  existingPaths,
  onAdd,
}: {
  back: RefObject<() => boolean>
  existingPaths: readonly string[]
  onAdd: (path: string) => void
}) {
  const picker = useFolderPicker(existingPaths, onAdd)
  useImperativeHandle(back, () => picker.back)
  const scrollIdle = useRef<ReturnType<typeof setTimeout>>(undefined)

  function onScroll(event: UIEvent<HTMLElement>) {
    const list = event.currentTarget
    list.dataset.scrolling = ''
    clearTimeout(scrollIdle.current)
    scrollIdle.current = setTimeout(() => delete list.dataset.scrolling, 800)
  }

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
      <div className='relative'>
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- combobox listbox; <select> can't host rich rows */}
        <div
          {...picker.list}
          onScroll={onScroll}
          className='scrollbar-auto-hide h-80 scroll-pb-14 overflow-y-auto overscroll-contain px-2 pb-14 mask-b-from-[calc(100%-3.5rem)]'
        >
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
        <div className='absolute right-3 bottom-3 flex h-8 items-center gap-2 rounded-full bg-popover pr-1.5 pl-3 text-xs text-muted-foreground shadow-lg ring-1 ring-foreground/10'>
          <span className='flex items-center gap-1.5'>
            {picker.activeIsUp ? 'Go up' : 'Open'}
            <Kbd>↵</Kbd>
          </span>
          <span aria-hidden='true' className='h-4 w-px bg-border' />
          <Button
            variant='ghost-text'
            size='xs'
            disabled={!picker.target || picker.target.added}
            onClick={picker.add}
            className='text-foreground'
          >
            {addLabel(picker)}
            <Kbd>⌘↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}

function addLabel({ target, activeIsUp }: ReturnType<typeof useFolderPicker>) {
  if (target?.added) return 'Already added'
  if (activeIsUp || !target) return 'Add this folder'
  return `Add ${target.name}`
}

const row =
  'flex h-10 cursor-default items-center gap-3 rounded-lg px-3 text-13 select-none hover:bg-muted data-[selected=true]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0'
const tag = 'ml-auto pl-4 text-xs text-muted-foreground'
