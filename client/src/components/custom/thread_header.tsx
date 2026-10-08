import { ArchiveArrowUpIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { useBot } from '@/state'
import { useNavigate } from '@tanstack/react-router'

import { BotAvatar } from './bot_avatar'
import { PageSidebarTrigger } from './page_sidebar_trigger'

export function ThreadHeader({
  onUnarchive,
  botId,
  title,
}: {
  // set while the thread is archived
  onUnarchive?: () => void
  botId?: string
  title?: string
}) {
  const bot = useBot(botId)
  const navigate = useNavigate()
  return (
    <header
      data-perf-region='thread-header'
      className='details-chat-header flex h-(--app-tab-bar-height) shrink-0 items-center gap-2 border-b border-border pr-[42px] pl-(--page-header-inset)'
    >
      <PageSidebarTrigger />
      {bot && (
        <div className='flex min-w-0 items-center gap-2 text-sm font-medium'>
          <button
            type='button'
            {...pressProps(() => void navigate({ to: '/bots/$botId', params: { botId: bot.id } }))}
            className='flex shrink-0 items-center gap-2 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
          >
            <BotAvatar bot={bot} size={20} unread={false} />
            {bot.name}
          </button>
          <span className='text-faint-foreground'>/</span>
          <span className='truncate'>{title}</span>
        </div>
      )}
      {onUnarchive && (
        <Button variant='ghost-text' size='sm' {...pressProps(onUnarchive)}>
          <ArchiveArrowUpIcon />
          Unarchive
        </Button>
      )}
    </header>
  )
}
