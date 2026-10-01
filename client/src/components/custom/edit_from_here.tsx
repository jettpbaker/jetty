import type { Attachment } from '@jetty/shared/items'

import { UndoIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useRewindThread } from '@/state/checkpoints'
import { useState } from 'react'

export function EditFromHere({
  threadId,
  messageId,
  attachments,
  worktree,
  disabled,
}: {
  threadId: string
  messageId: string
  attachments: readonly Attachment[]
  worktree: boolean
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const { pending, rewind: applyRewind } = useRewindThread(threadId)
  function rewind(restoreFiles: boolean) {
    applyRewind(messageId, attachments, restoreFiles, () => setOpen(false))
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              tone='muted'
              size='icon-xs'
              aria-label='Edit from here'
              disabled={disabled || pending}
              onClick={() => setOpen(true)}
            />
          }
        >
          <UndoIcon />
        </TooltipTrigger>
        <TooltipContent>Edit from here</TooltipContent>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Edit from here?</DialogTitle>
            <DialogDescription>
              Rewind the conversation to before this message. Your message returns to the composer.
              {!worktree && (
                <> Files stay as they are because this thread works in your checkout.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || disabled} onClick={() => rewind(false)}>
              {worktree ? 'Keep file changes' : 'Rewind'}
            </Button>
            {worktree && (
              <Button
                variant='destructive'
                disabled={pending || disabled}
                onClick={() => rewind(true)}
              >
                Revert files too
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
