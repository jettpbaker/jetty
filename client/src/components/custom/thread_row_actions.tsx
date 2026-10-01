import {
  ArchiveArrowUpIcon,
  MoreVerticalIcon,
  Edit03Icon,
  PinIcon,
  Delete02Icon,
  Archive02Icon,
} from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useEffect, useRef, useState, type FormEvent } from 'react'

type ActionOverlay = 'closed' | 'menu' | 'edit'

export type ThreadRowActionsProps = {
  title: string
  pinned: boolean
  archived?: boolean
  onArchive: () => void
  onDelete: () => void
  onPin: () => void
  onRename: (title: string) => void
}

export function ThreadRowActions({
  title,
  pinned,
  archived = false,
  onArchive,
  onDelete,
  onPin,
  onRename,
}: ThreadRowActionsProps) {
  const [overlay, setOverlay] = useState<ActionOverlay>('closed')
  const [draft, setDraft] = useState(title)
  const titleInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (overlay === 'edit') titleInput.current?.focus()
  }, [overlay])
  function changeOverlay(target: Exclude<ActionOverlay, 'closed'>, open: boolean) {
    setOverlay((current) => (open ? target : current === target ? 'closed' : current))
  }

  function editTitle() {
    setDraft(title)
    setOverlay('edit')
  }

  function saveTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextTitle = draft.trim()
    if (!nextTitle) return
    onRename(nextTitle)
    setOverlay('closed')
  }

  return (
    <>
      <div className='thread-row-actions' data-overlay={overlay}>
        <Button
          variant='ghost-text'
          size='icon'
          className='thread-row-action'
          aria-label={`${archived ? 'Unarchive' : 'Archive'} ${title}`}
          onClick={onArchive}
        >
          {archived ? (
            <ArchiveArrowUpIcon className='size-3' />
          ) : (
            <Archive02Icon className='size-3' />
          )}
        </Button>
        <DropdownMenu
          open={overlay === 'menu'}
          onOpenChange={(open) => changeOverlay('menu', open)}
        >
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost-text'
                size='icon'
                className='thread-row-action'
                aria-label={`Actions for ${title}`}
              />
            }
          >
            <MoreVerticalIcon className='size-3.5' aria-hidden='true' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-36'>
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={editTitle}>
                <Edit03Icon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPin}>
                <PinIcon filled={pinned} />
                {pinned ? 'Unpin' : 'Pin'}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant='destructive' onClick={onDelete}>
                <Delete02Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={overlay === 'edit'} onOpenChange={(open) => changeOverlay('edit', open)}>
        <DialogContent>
          <DialogTitle>Edit thread</DialogTitle>
          <form className='flex flex-col gap-4' onSubmit={saveTitle}>
            <Input
              ref={titleInput}
              aria-label='Thread title'
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <DialogFooter>
              <Button type='button' variant='ghost' onClick={() => setOverlay('closed')}>
                Cancel
              </Button>
              <Button type='submit' disabled={!draft.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
