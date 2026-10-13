import type { Bot } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useArchiveBot, useDeleteBot } from '@/state'
import { useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'

import { BotAvatar } from './bot_avatar'
import { ArrowOutOfBoxIcon, TrashCanSimpleIcon } from './central_icons'
import { PageSidebarTrigger } from './page_sidebar_trigger'

// Archive leaves the bot's page. Undo returns only while the user is still on home, matching
// thread archive.
export function useArchiveBotAction() {
  const archive = useArchiveBot()
  const navigate = useNavigate()
  const router = useRouter()
  const currentBotId = useParams({ strict: false }).botId
  return (bot: Bot) => {
    archive(bot.id, true)
    const left = currentBotId === bot.id
    if (left) void navigate({ to: '/' })
    toast('Bot archived', {
      action: {
        label: 'Undo',
        onClick: () => {
          archive(bot.id, false)
          if (left && router.state.location.pathname === '/')
            void navigate({ to: '/bots/$botId', params: { botId: bot.id } })
        },
      },
    })
  }
}

export function DeleteBotDialog({
  bot,
  open,
  onOpenChange,
}: {
  bot: Bot
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const remove = useDeleteBot()
  const navigate = useNavigate()
  const currentBotId = useParams({ strict: false }).botId
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {bot.name}?</DialogTitle>
          <DialogDescription>
            This deletes the bot and its home. Its threads stay, without the bot. This can&apos;t be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={() => {
              onOpenChange(false)
              remove(bot.id)
              if (currentBotId === bot.id) void navigate({ to: '/' })
            }}
          >
            Delete bot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ArchivedBot({ bot }: { bot: Bot }) {
  const archive = useArchiveBot()
  const [deleting, setDeleting] = useState(false)
  return (
    <section className='flex h-full min-h-0 flex-col' aria-label={`${bot.name} is archived`}>
      <PageSidebarTrigger standalone />
      <div className='flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center'>
        <BotAvatar bot={bot} size={48} unread={false} />
        <div className='flex max-w-sm flex-col gap-1'>
          <h1 className='text-sm font-medium'>{bot.name} is archived</h1>
          <p className='text-13 text-muted-foreground'>
            Its threads are still in the sidebar. Restore it to bring them back under it.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' onClick={() => archive(bot.id, false)}>
            <ArrowOutOfBoxIcon />
            Restore
          </Button>
          <Button variant='destructive' size='sm' onClick={() => setDeleting(true)}>
            <TrashCanSimpleIcon />
            Delete
          </Button>
        </div>
      </div>
      <DeleteBotDialog bot={bot} open={deleting} onOpenChange={setDeleting} />
    </section>
  )
}
