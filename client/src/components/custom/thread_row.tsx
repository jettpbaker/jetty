import type { ProviderId } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowElbowDownRightIcon } from '@phosphor-icons/react'
import { RepoIcon } from '@primer/octicons-react'

import { OverflowTitle } from './overflow_title'
import { ThreadHoverCard } from './thread_hover'
import { prPresentation, type ThreadPullRequest } from './thread_pull_request'
import { ThreadRowActions, type ThreadRowActionsProps } from './thread_row_actions'
import { ThreadStatusGlyph, type ThreadStatus } from './thread_status'
import './thread_row.css'

export function ThreadRow({
  title,
  project,
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
}: {
  title: string
  project: string
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
}) {
  const pr = pullRequest && prPresentation[pullRequest.state]

  return (
    <div className='thread-row' data-selected={selected || undefined}>
      <ThreadHoverCard
        details={{ title, project, provider, lastActivity, pullRequest }}
        model={model}
        effort={effort}
        status={status}
      >
        {(trigger) => (
          <Button
            data-overflow-hover
            render={trigger}
            variant='ghost-text'
            aria-pressed={selected}
            onClick={onSelect}
            className='h-auto w-full min-w-0 flex-col items-stretch gap-1.5 rounded-sm px-2.5 py-1.5 text-left font-normal active:translate-y-0'
          >
            <span className='flex min-w-0 items-center justify-between gap-3'>
              <OverflowTitle
                focusable={false}
                className='font-normal leading-normal text-foreground'
              >
                {title}
              </OverflowTitle>
              <ThreadStatusGlyph status={status} iconClassName='size-3.5' />
            </span>
            <span className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
              {parent ? (
                <span className='flex min-w-0 items-center gap-1' title={`Created by ${parent}`}>
                  <ArrowElbowDownRightIcon aria-hidden='true' className='size-3 shrink-0' />
                  <span className='truncate'>{parent}</span>
                </span>
              ) : (
                <span className='flex min-w-0 items-center gap-1' title={project}>
                  <RepoIcon aria-hidden='true' className='icon-optical-down size-3' />
                  <span className='truncate'>{project}</span>
                </span>
              )}
              {pullRequest && pr && (
                <>
                  <span aria-hidden='true' className='shrink-0 text-muted-foreground'>
                    ·
                  </span>
                  <span
                    className='flex shrink-0 items-center gap-1'
                    title={`${pr.label} PR #${pullRequest.number}`}
                  >
                    <pr.icon aria-hidden='true' className={cn('size-3', pr.color)} />
                    <span className='font-mono'>{`#${pullRequest.number}`}</span>
                    <span className='sr-only'>{pr.label}</span>
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
            </span>
          </Button>
        )}
      </ThreadHoverCard>
      <ThreadRowActions title={title} {...actions} />
    </div>
  )
}
