import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  RepoIcon,
} from '@primer/octicons-react'

import { OverflowTitle } from './overflow_title'
import { ThreadRowActions, type ThreadRowActionsProps } from './thread_row_actions'
import { ThreadStatusGlyph, type ThreadStatus } from './thread_status'
import './thread_row.css'

const prPresentation = {
  draft: { icon: GitPullRequestDraftIcon, label: 'Draft', color: 'text-pr-draft' },
  open: { icon: GitPullRequestIcon, label: 'Open', color: 'text-pr-open' },
  merged: { icon: GitMergeIcon, label: 'Merged', color: 'text-pr-merged' },
  closed: { icon: GitPullRequestClosedIcon, label: 'Closed', color: 'text-pr-closed' },
}

export type ThreadPullRequest = { number: number; state: keyof typeof prPresentation }

export function ThreadRow({
  title,
  project,
  status,
  lastActivity,
  pullRequest,
  selected,
  actions,
  onSelect,
}: {
  title: string
  project: string
  status: ThreadStatus
  lastActivity: string
  pullRequest?: ThreadPullRequest
  selected: boolean
  actions: Omit<ThreadRowActionsProps, 'title'>
  onSelect: () => void
}) {
  const pr = pullRequest && prPresentation[pullRequest.state]

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
      <ThreadRowActions title={title} {...actions} />
    </div>
  )
}
