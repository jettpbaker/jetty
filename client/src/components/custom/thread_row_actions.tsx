import { Button } from '@/components/ui/button'
import { ArchiveIcon } from '@primer/octicons-react'

export type ThreadRowActionsProps = {
  title: string
  onArchive: () => void
}

export function ThreadRowActions({ title, onArchive }: ThreadRowActionsProps) {
  return (
    <div className='thread-row-actions'>
      <Button
        variant='ghost-text'
        size='icon'
        className='thread-row-action'
        aria-label={`Archive ${title}`}
        onClick={onArchive}
      >
        <ArchiveIcon className='size-3' />
      </Button>
    </div>
  )
}
