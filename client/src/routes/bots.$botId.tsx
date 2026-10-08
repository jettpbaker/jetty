import { BotAvatar } from '@/components/custom/bot_avatar'
import { BotChat } from '@/components/custom/bot_chat'
import { SidebarLeftIcon } from '@/components/custom/huge_icons'
import { Loading } from '@/components/custom/loading'
import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { Button } from '@/components/ui/button'
import { useBot, useChromeReady, useMarkBotSeen } from '@/state'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/bots/$botId')({ component: BotChatRoute })

function BotChatRoute() {
  const { botId } = Route.useParams()
  const bot = useBot(botId)
  const ready = useChromeReady()
  const markSeen = useMarkBotSeen()
  useEffect(() => {
    if (bot?.unread) markSeen(botId)
  }, [bot?.unread, botId, markSeen])
  if (!bot)
    return (
      <section className='flex h-full min-h-0 flex-col' aria-label='Bot chat'>
        <PageSidebarTrigger standalone />
        {ready ? (
          <div className='flex flex-1 items-center justify-center text-sm text-muted-foreground'>
            Bot not found
          </div>
        ) : (
          <Loading label='Loading bot…' />
        )}
      </section>
    )
  return (
    <section className='flex h-full min-h-0 flex-col' aria-label={`Chat with ${bot.name}`}>
      <header className='flex h-(--app-tab-bar-height) shrink-0 items-center gap-2 border-b border-border pl-(--page-header-inset) pr-4'>
        <PageSidebarTrigger />
        <BotAvatar bot={bot} size={20} unread={false} />
        <span className='text-sm font-medium'>{bot.name}</span>
        <Button
          variant='ghost'
          size='icon'
          disabled
          aria-label='Open bot details'
          className='ml-auto'
        >
          <SidebarLeftIcon className='rotate-180' />
        </Button>
      </header>
      <BotChat key={bot.id} bot={bot} />
    </section>
  )
}
