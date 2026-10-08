import { BotAvatar } from '@/components/custom/bot_avatar'
import { BotChat } from '@/components/custom/bot_chat'
import { BotDetailsLayout } from '@/components/custom/bot_details_layout'
import { BotSettingsSheet } from '@/components/custom/bot_settings_sheet'
import { Loading } from '@/components/custom/loading'
import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { useBot, useChromeReady, useMarkBotSeen } from '@/state'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/bots/$botId')({ component: BotChatRoute })

function BotChatRoute() {
  const { botId } = Route.useParams()
  const bot = useBot(botId)
  const ready = useChromeReady()
  const markSeen = useMarkBotSeen()
  const [section, setSection] = useState<HTMLElement | null>(null)
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
    <section
      ref={setSection}
      className='relative flex h-full min-h-0 flex-col'
      aria-label={`Chat with ${bot.name}`}
    >
      <BotDetailsLayout bot={bot}>
        <header className='details-chat-header flex h-(--app-tab-bar-height) shrink-0 items-center gap-2 border-b border-border pr-[42px] pl-(--page-header-inset)'>
          <PageSidebarTrigger />
          <BotAvatar bot={bot} size={20} unread={false} />
          <span className='text-sm font-medium'>{bot.name}</span>
          <BotSettingsSheet bot={bot} />
        </header>
        <BotChat key={bot.id} bot={bot} overlayHost={section} />
      </BotDetailsLayout>
    </section>
  )
}
