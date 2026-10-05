import type { ProjectIcon, ProviderId } from '@jetty/shared/wire'

import { ArrowMoveDownRightIcon } from '@/components/custom/huge_icons'

import { HoverKeybind, type Keybind } from './keybinds'
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
  parent,
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
  parent?: string
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
  actions: Omit<ThreadRowActionsProps, 'title'>
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
              <span className='ml-auto flex shrink-0 items-center gap-1.5'>
                {shortcut && <HoverKeybind binding={shortcut} />}
                <StatusGlyph status={status} />
              </span>
            }
            metaClassName='gap-2.5'
          >
            {parent ? (
              <span className='flex min-w-0 items-center gap-1' title={`Created by ${parent}`}>
                <ArrowMoveDownRightIcon aria-hidden='true' className='size-3 shrink-0' />
                <span className='truncate'>{parent}</span>
              </span>
            ) : (
              <span className='flex min-w-0 items-center gap-1' title={project}>
                <ProjectGlyph icon={projectIcon} className='size-3' />
                <span className='truncate'>{project}</span>
              </span>
            )}
            {pullRequests.length > 0 && (
              <span data-pull-request className='flex shrink-0'>
                <PullRequestMark pullRequests={pullRequests} />
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
      <ThreadRowActions title={title} {...actions} />
    </div>
  )
}
