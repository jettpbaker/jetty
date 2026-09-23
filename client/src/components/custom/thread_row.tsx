import type { ProjectIcon, ProviderId } from '@jetty/shared/wire'

import { ArrowElbowDownRightIcon } from '@phosphor-icons/react'

import { OverflowTitle } from './overflow_title'
import { ProjectGlyph } from './project_glyph'
import { ThreadHoverCard } from './thread_hover'
import { PullRequestMark, pullRequestLabel, type ThreadPullRequest } from './thread_pull_request'
import { ThreadRowActions, type ThreadRowActionsProps } from './thread_row_actions'
import { StatusGlyph, type ThreadStatus } from './thread_status'
import { TwoLineRow } from './two_line_row'
import './thread_row.css'

export function ThreadRow({
  title,
  project,
  projectIcon,
  parent,
  status,
  lastActivity,
  pullRequest,
  provider,
  model,
  effort,
  selected,
  actions,
  onSelect,
  onOpenPullRequest,
}: {
  title: string
  project: string
  projectIcon?: ProjectIcon
  parent?: string
  status: ThreadStatus
  lastActivity: string
  pullRequest?: ThreadPullRequest
  provider?: ProviderId
  model?: string
  effort?: string
  selected: boolean
  actions: Omit<ThreadRowActionsProps, 'title'>
  onSelect: () => void
  onOpenPullRequest: () => void
}) {
  const prLabel = pullRequest && pullRequestLabel(pullRequest)

  return (
    <div className='thread-row' data-selected={selected || undefined}>
      <ThreadHoverCard
        details={{ title, project, projectIcon, provider, lastActivity, pullRequest }}
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
            glyph={<StatusGlyph status={status} />}
          >
            {parent ? (
              <span className='flex min-w-0 items-center gap-1' title={`Created by ${parent}`}>
                <ArrowElbowDownRightIcon aria-hidden='true' className='size-3 shrink-0' />
                <span className='truncate'>{parent}</span>
              </span>
            ) : (
              <span className='flex min-w-0 items-center gap-1' title={project}>
                <ProjectGlyph icon={projectIcon} className='size-3' />
                <span className='truncate'>{project}</span>
              </span>
            )}
            {pullRequest && prLabel && (
              <>
                <span aria-hidden='true' className='shrink-0 text-muted-foreground'>
                  ·
                </span>
                <span
                  data-pull-request
                  className='flex shrink-0 items-center gap-1 hover:text-foreground'
                  title={prLabel.title}
                >
                  <PullRequestMark pullRequest={pullRequest} />
                </span>
              </>
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
