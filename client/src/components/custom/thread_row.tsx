import type { ProjectIcon } from '@jetty/shared/wire'

import { useBot } from '@/state'

import { JettyBot } from './jetty_bot'
import { HeldKeybind, type Keybind } from './keybinds'
import { OverflowTitle } from './overflow_title'
import { ProjectGlyph } from './project_glyph'
import { ThreadHoverCard } from './thread_hover'
import { PullRequestMark, type ThreadPullRequest } from './thread_pull_request'
import { ThreadRowActions, type ThreadRowActionsProps } from './thread_row_actions'
import { StatusGlyph, type ThreadStatus } from './thread_status'
import { TwoLineRow } from './two_line_row'
import './thread_row.css'

export function ThreadRow({
  id,
  botId,
  title,
  project,
  projectIcon,
  status,
  lastActivity,
  pullRequests,
  shortcut,
  selected,
  actions,
  onSelect,
  onOpenPullRequest,
}: {
  id: string
  botId?: string
  title: string
  project: string
  projectIcon?: ProjectIcon
  status: ThreadStatus
  lastActivity: string
  pullRequests: readonly ThreadPullRequest[]
  shortcut?: Keybind
  selected: boolean
  actions: Omit<ThreadRowActionsProps, 'title' | 'shortcut'>
  onSelect: () => void
  onOpenPullRequest: () => void
}) {
  const bot = useBot(botId)
  return (
    <div className='thread-row keybind-target' data-selected={selected || undefined}>
      <ThreadHoverCard threadId={id}>
        {(trigger) => (
          <TwoLineRow
            render={trigger}
            variant='ghost-text'
            aria-pressed={selected}
            onClick={(event) =>
              event.target instanceof Element && event.target.closest('[data-pull-request]')
                ? onOpenPullRequest()
                : onSelect()
            }
            heading={
              <span className='flex min-w-0 flex-1 items-center gap-0.5'>
                {bot && (
                  <>
                    {/* The face's slot is a pixel narrower than the face, as the board draws it. */}
                    <span className='relative h-3.5 w-[13px] shrink-0'>
                      <JettyBot
                        shape={bot.shape}
                        color={bot.color}
                        size={14}
                        className='absolute top-0 -left-px'
                      />
                    </span>
                    <span className='shrink-0 text-faint-foreground'>/</span>
                  </>
                )}
                <OverflowTitle focusable={false} className='font-normal leading-normal'>
                  {title}
                </OverflowTitle>
              </span>
            }
            glyph={
              <span className='ml-auto flex shrink-0 items-center'>
                <HeldKeybind binding={shortcut}>
                  <StatusGlyph status={status} />
                </HeldKeybind>
              </span>
            }
            metaClassName='gap-2.5'
          >
            <span className='flex min-w-0 items-center gap-1' title={project}>
              <ProjectGlyph icon={projectIcon} className='size-3' />
              <span className='truncate'>{project}</span>
            </span>
            {pullRequests.length > 0 && (
              <span data-pull-request className='flex shrink-0'>
                <PullRequestMark pullRequests={pullRequests} tooltip={false} />
              </span>
            )}
            <span
              className='ml-auto mr-px shrink-0 font-mono'
              aria-label={
                lastActivity === 'now'
                  ? 'Last activity just now'
                  : `Last activity ${lastActivity} ago`
              }
            >
              {lastActivity}
            </span>
          </TwoLineRow>
        )}
      </ThreadHoverCard>
      <ThreadRowActions title={title} shortcut={shortcut} {...actions} />
    </div>
  )
}
