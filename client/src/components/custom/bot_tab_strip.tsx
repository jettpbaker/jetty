import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pressProps } from '@/lib/press'
import { isStringRecord, useStoredState } from '@/lib/stored-state'
import { useBot } from '@/state'
import { botThreadsByBot, useSidebarList } from '@/state/sidebar'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'

import { BotAvatar } from './bot_avatar'
import { appShortcut, keybinds } from './keybinds'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { TabLabel } from './thread_details_tabs'
import { StatusGlyph, threadStatus } from './thread_status'

const botTab = 'bot'
const tabClass = 'details-header-tab h-auto max-w-48 min-w-0 flex-none rounded-sm px-1 py-1 text-xs'

// The hidden thread tabs per bot, per browser. They stay the bot's threads and nest in the sidebar.
const hiddenKey = 'jetty.bot-tabs.hidden'

// A bot's work context in the page header: the bot, then a tab per unarchived thread it owns.
export function BotTabStrip({
  botId,
  threadId,
  children,
}: {
  botId: string
  threadId?: string
  children?: ReactNode
}) {
  const bot = useBot(botId)
  const list = useSidebarList()
  const navigate = useNavigate()
  const [hiddenByBot, setHiddenByBot] = useStoredState(hiddenKey, {}, isStringRecord)
  const hidden = hiddenByBot[botId] ?? []
  const activeRef = useRef<HTMLButtonElement>(null)
  const active = threadId ?? botTab

  // Opening a hidden thread by any other route brings its tab back.
  useEffect(() => {
    if (!threadId) return
    setHiddenByBot((all) =>
      all[botId]?.includes(threadId)
        ? { ...all, [botId]: all[botId].filter((id) => id !== threadId) }
        : all
    )
  }, [botId, threadId, setHiddenByBot])
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const nested = botThreadsByBot(list?.threads ?? []).get(botId) ?? []
  const threads = nested.filter((thread) => thread.id === threadId || !hidden.includes(thread.id))
  const archived = threadId && !nested.some((thread) => thread.id === threadId)
  const current = archived ? list?.threads.find((thread) => thread.id === threadId) : undefined
  const tabs = current ? [...threads, current] : threads
  const ids = [botTab, ...tabs.map((thread) => thread.id)]

  function open(id: string) {
    if (id === botTab) void navigate({ to: '/bots/$botId', params: { botId } })
    else void navigate({ to: '/threads/$threadId', params: { threadId: id } })
  }
  function close(id: string) {
    if (id === active) open(ids[ids.indexOf(id) - 1] ?? botTab)
    setHiddenByBot((all) => ({ ...all, [botId]: [...(all[botId] ?? []), id] }))
  }
  function cycle(step: number) {
    const index = ids.indexOf(active)
    open(ids[(index + step + ids.length) % ids.length]!)
  }
  useHotkey(
    keybinds.previousTab.hotkey,
    (event) => {
      if (appShortcut(event)) cycle(-1)
    },
    { requireReset: true, ignoreInputs: false }
  )
  useHotkey(
    keybinds.nextTab.hotkey,
    (event) => {
      if (appShortcut(event)) cycle(1)
    },
    { requireReset: true, ignoreInputs: false }
  )

  return (
    <header
      data-perf-region='thread-header'
      className='details-chat-header flex h-(--app-tab-bar-height) shrink-0 items-center gap-2 pr-[42px] pl-(--page-header-inset)'
    >
      <PageSidebarTrigger />
      <Tabs value={active} className='min-w-0 flex-1'>
        {/* A tab's 5px inset (border and padding) hangs left of the header's, so the bot's face sits
            on the header inset. */}
        <div className='no-scrollbar scroll-fade-x -ml-1.25 overflow-x-auto overflow-y-hidden'>
          <TabsList
            activateOnFocus={false}
            variant='line'
            aria-label={`${bot?.name ?? 'Bot'} work`}
            className='w-max gap-1.5 px-0 py-1'
          >
            <TabsTrigger
              ref={active === botTab ? activeRef : undefined}
              value={botTab}
              className={tabClass}
              {...pressProps(() => open(botTab))}
            >
              {bot && <BotAvatar bot={bot} size={16} unread={false} />}
              <span className='min-w-0 truncate'>{bot?.name}</span>
            </TabsTrigger>
            {tabs.map((thread) => (
              <TabsTrigger
                key={thread.id}
                ref={thread.id === active ? activeRef : undefined}
                value={thread.id}
                className={tabClass}
                data-hover-close
                title={thread.title}
                {...pressProps(() => open(thread.id))}
              >
                <TabLabel
                  label={thread.title}
                  icon={
                    <StatusGlyph
                      status={threadStatus(thread.status, thread.readyForReview)}
                      className='details-tab-kind size-3.25'
                    />
                  }
                  canClose
                  onClose={() => close(thread.id)}
                />
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      {children}
    </header>
  )
}
