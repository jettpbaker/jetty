import { ThreadStatusGlyph, type ThreadStatus } from '@/components/custom/thread_status'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { RepoIcon } from '@primer/octicons-react'

import { OverflowTitle } from './overflow_title'
import { latestPullRequest, prPresentation, type ThreadPullRequest } from './thread_pull_request'
import { ThreadRowActions, type ThreadRowActionsProps } from './thread_row_actions'
import './thread_row.css'

export type { ThreadPullRequest } from './thread_pull_request'
export type { ThreadStatus } from '@/components/custom/thread_status'

type ThreadRowProps = {
  title: string
  project: string
  status: ThreadStatus
  lastActivity: string
  pullRequests?: readonly ThreadPullRequest[]
  selected?: boolean
  actions?: Omit<ThreadRowActionsProps, 'title'>
  onSelect: () => void
}

export function ThreadRow({
  title,
  project,
  status,
  lastActivity,
  pullRequests = [],
  selected = false,
  onSelect,
  actions,
}: ThreadRowProps) {
  const latestPr = latestPullRequest(pullRequests)
  const pr = latestPr ? prPresentation[latestPr.status] : undefined
  const PrIcon = pr?.icon

  return (
    <div className='thread-row' data-selected={selected || undefined}>
      <Button
        data-overflow-hover
        variant='ghost-text'
        aria-pressed={selected}
        onClick={onSelect}
        className='h-auto w-full min-w-0 flex-col items-stretch gap-1.5 rounded-sm px-2.5 py-1.5 text-left font-normal active:translate-y-0'
      >
        <span className='flex min-w-0 items-center justify-between gap-3'>
          <OverflowTitle focusable={false} className='font-normal leading-normal text-foreground'>
            {title}
          </OverflowTitle>
          <ThreadStatusGlyph status={status} iconClassName='size-3.5' />
        </span>
        <span className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
          <span className='flex min-w-0 items-center gap-1' title={project}>
            <RepoIcon aria-hidden='true' className='icon-optical-down size-3' />
            <span className='truncate'>{project}</span>
          </span>
          {latestPr && pr && PrIcon && (
            <>
              <span aria-hidden='true' className='shrink-0 text-muted-foreground'>
                ·
              </span>
              <span
                className='flex shrink-0 items-center gap-1'
                title={`${pr.label} PR #${latestPr.number}${pullRequests.length > 1 ? ' · most recently updated' : ''}`}
              >
                <PrIcon aria-hidden='true' className={cn('size-3', pr.color)} />
                <span className='font-mono'>
                  {pullRequests.length > 1 ? `${pullRequests.length} PRs` : `#${latestPr.number}`}
                </span>
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
      {actions && <ThreadRowActions title={title} {...actions} />}
    </div>
  )
}
