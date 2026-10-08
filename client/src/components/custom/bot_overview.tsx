import type { Bot, BotTask, ThreadMeta } from '@jetty/shared/wire'

import { ArrowRight01Icon, CircleIcon, Tick02Icon } from '@/components/custom/huge_icons'
import { CircleSlashIcon } from '@/components/custom/lucide_icons'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { describeLoadout } from '@/lib/loadout'
import { cn } from '@/lib/utils'
import { useBotThreadMetas, useModels, useProjects, useThreadRowPrefetch } from '@/state'
import { catalogModelName } from '@jetty/shared/model-name'
import { useNavigate } from '@tanstack/react-router'

import { ThreadFace } from './bot_avatar'
import { BotSettingsSheet } from './bot_settings_sheet'
import { InProgressIcon } from './in_progress_icon'
import { OverflowTitle } from './overflow_title'
import { ProviderGlyph } from './provider_glyph'
import { sidebarThread } from './sidebar_thread_groups'
import { Section, useCollapsedSections } from './thread_overview'
import { statusPresentation } from './thread_status'
import { TwoLineRow } from './two_line_row'

export function BotOverview({ bot }: { bot: Bot }) {
  const threads = useBotThreadMetas(bot.id)
  const { sectionProps } = useCollapsedSections('jetty.bot-overview.collapsed')
  return (
    <div className='scrollbar-subtle h-full overflow-auto'>
      <div className='flex flex-col gap-3.5 p-2 text-sm'>
        <ModelRow bot={bot} />
        {bot.tasks.length > 0 && (
          <Section label='Tasks' count={bot.tasks.length} {...sectionProps('tasks')}>
            <ol className='flex flex-col gap-1'>
              {bot.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ol>
          </Section>
        )}
        {threads.length > 0 && (
          <Section label='Threads' count={threads.length} {...sectionProps('threads')}>
            <BotThreadList bot={bot} threads={threads} />
          </Section>
        )}
      </div>
    </div>
  )
}

// Opens the bot's settings.
function ModelRow({ bot }: { bot: Bot }) {
  const models = useModels()
  const loadout = describeLoadout(bot)
  return (
    <BotSettingsSheet bot={bot}>
      <Button
        variant='ghost'
        className='h-9 w-full justify-start gap-2 rounded-sm px-2.5 font-normal'
      >
        <span className='w-21 shrink-0 text-left text-muted-foreground'>Model</span>
        <ProviderGlyph provider={bot.provider} className='size-3.5 text-muted-foreground' />
        <span className='truncate text-foreground'>
          {catalogModelName(models, bot.provider, bot.model)}
        </span>
        {loadout && <span className='text-muted-foreground'>{loadout}</span>}
        <ArrowRight01Icon className='ml-auto size-3' />
      </Button>
    </BotSettingsSheet>
  )
}

const taskStatusLabels = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  dropped: 'Dropped',
} satisfies Record<BotTask['status'], string>

function TaskGlyph({ status }: { status: BotTask['status'] }) {
  const className = 'size-3.5 shrink-0 text-muted-foreground'
  switch (status) {
    case 'in_progress':
      return <InProgressIcon aria-hidden='true' className='size-3.5 shrink-0 text-status-working' />
    case 'done':
      return <Tick02Icon className={className} />
    // Lucide's, as for an issue closed as not planned.
    case 'dropped':
      return <CircleSlashIcon aria-hidden='true' className={className} />
    case 'todo':
      return <CircleIcon className={className} />
  }
}

function TaskRow({ task }: { task: BotTask }) {
  const closed = task.status === 'done' || task.status === 'dropped'
  return (
    <li className='flex gap-2 px-2.5 py-1.25'>
      <span className='pt-0.75'>
        <TaskGlyph status={task.status} />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <span className={cn(closed && 'text-muted-foreground line-through decoration-1')}>
          <span className='sr-only'>{taskStatusLabels[task.status]}: </span>
          {task.title}
        </span>
        {task.note && <span className='text-xs text-muted-foreground'>{task.note}</span>}
      </div>
    </li>
  )
}

function BotThreadList({ bot, threads }: { bot: Bot; threads: readonly ThreadMeta[] }) {
  const projects = useProjects()
  const navigate = useNavigate()
  const prefetch = useThreadRowPrefetch()
  const now = useNow(60_000)
  return (
    <div className='flex flex-col gap-0.5'>
      {threads.map((thread) => {
        const row = sidebarThread(
          { thread, project: projects?.find((project) => project.id === thread.projectId) },
          now
        )
        return (
          <TwoLineRow
            key={thread.id}
            onClick={() =>
              void navigate({ to: '/threads/$threadId', params: { threadId: thread.id } })
            }
            onPointerEnter={() => prefetch.enter(thread.id)}
            onPointerLeave={() => prefetch.leave(thread.id)}
            heading={
              <OverflowTitle focusable={false} className='font-normal leading-normal'>
                {row.title}
              </OverflowTitle>
            }
            glyph={null}
            metaClassName='gap-1'
          >
            <ThreadFace bot={bot} threadId={thread.id} status={row.status} size={14} />
            <span className='min-w-0 flex-1 truncate'>{row.project}</span>
            <span
              className='mr-px shrink-0 font-mono'
              aria-label={`${statusPresentation[row.status].label}, ${
                row.lastActivity === 'now'
                  ? 'last activity just now'
                  : `last activity ${row.lastActivity} ago`
              }`}
            >
              {row.lastActivity}
            </span>
          </TwoLineRow>
        )
      })}
    </div>
  )
}
