import type { ProjectIcon, ProviderId } from '@jetty/shared/wire'

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
  title,
  project,
  projectId,
  projectIcon,
  status,
  lastActivity,
  pullRequests,
  environment,
  branch,
  provider,
  model,
  effort,
  shortcut,
  selected,
  actions,
  onSelect,
  onOpenPullRequest,
}: {
  title: string
  project: string
  projectId: string
  projectIcon?: ProjectIcon
  status: ThreadStatus
  lastActivity: string
  pullRequests: readonly ThreadPullRequest[]
  environment: 'local' | 'worktree'
  branch?: string
  provider?: ProviderId
  model?: string
  effort?: string
  shortcut?: Keybind
  selected: boolean
  actions: Omit<ThreadRowActionsProps, 'title' | 'shortcut'>
  onSelect: () => void
  onOpenPullRequest: () => void
}) {
  return (
    <div className='thread-row keybind-target' data-selected={selected || undefined}>
      <ThreadHoverCard
        details={{
          title,
          project,
          projectId,
          projectIcon,
          provider,
          lastActivity,
          pullRequests,
          environment,
          branch,
        }}
        onOpenPullRequest={onOpenPullRequest}
        model={model}
        effort={effort}
        status={status}
      >
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
              <OverflowTitle focusable={false} className='font-normal leading-normal'>
                {title}
              </OverflowTitle>
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
