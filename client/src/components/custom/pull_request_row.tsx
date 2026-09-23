import type { PullRequestLink } from '@jetty/shared/wire'

import { formatAge } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useOpenPullRequest, usePullRequestSummary } from '@/state'
import { CaretLeftIcon } from '@phosphor-icons/react'

import { OverflowTitle } from './overflow_title'
import { pullRequestState } from './pull_request_model'
import { linkPresentation } from './thread_pull_request'
import { TwoLineRow } from './two_line_row'

export function PullRequestRow({
  threadId,
  link,
  now,
}: {
  threadId: string
  link: PullRequestLink
  now: number
}) {
  const open = useOpenPullRequest()
  const pull = usePullRequestSummary(link)
  const pr = linkPresentation(pull ? pullRequestState(pull) : link.state)
  const age = formatAge(link.updatedAt ?? link.linkedAt, now)
  return (
    <TwoLineRow
      onClick={() => open(threadId, link)}
      heading={
        <OverflowTitle focusable={false} className='font-normal leading-normal'>
          {pull?.title ?? link.title ?? `${link.repo}#${link.number}`}
        </OverflowTitle>
      }
      glyph={
        <span className={cn('flex shrink-0 items-center', pr.color)} title={pr.label}>
          <pr.icon aria-hidden='true' className='size-3.5' />
          <span className='sr-only'>{pr.label}</span>
        </span>
      }
    >
      <span className='shrink-0 font-mono' title={link.repo}>
        #{link.number}
      </span>
      {pull ? (
        <>
          <span className='flex min-w-0 items-center gap-1 font-mono'>
            <span className='truncate'>{pull.base.ref}</span>
            <CaretLeftIcon className='icon-optical-down size-2.5 shrink-0' />
            <span className='truncate'>{pull.head.ref}</span>
          </span>
          <span className='shrink-0 font-mono tabular-nums'>
            <span className='text-status-success'>+{pull.additions}</span>{' '}
            <span className='text-status-error'>−{pull.deletions}</span>
          </span>
        </>
      ) : (
        <span className='truncate'>{link.repo}</span>
      )}
      <span
        className='ml-auto mr-px shrink-0 font-mono'
        aria-label={age === 'now' ? 'Updated just now' : `Updated ${age} ago`}
      >
        {age}
      </span>
    </TwoLineRow>
  )
}
