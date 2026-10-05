import type { PullRequestLink, PullRequestListItem } from '@jetty/shared/wire'

import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from '@/components/custom/lucide_icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const prPresentation = {
  draft: { icon: GitPullRequestDraftIcon, label: 'Draft', color: 'text-pr-draft' },
  open: { icon: GitPullRequestIcon, label: 'Open', color: 'text-pr-open' },
  merged: { icon: GitMergeIcon, label: 'Merged', color: 'text-pr-merged' },
  closed: { icon: GitPullRequestClosedIcon, label: 'Closed', color: 'text-pr-closed' },
}

type PullRequestReadiness = Pick<PullRequestListItem, 'checks' | 'reviewDecision' | 'mergeable'> &
  Pick<PullRequestLink, 'failingChecks'>

export type ThreadPullRequest = PullRequestReadiness & {
  repo: string
  number: number
  state: keyof typeof prPresentation
}

// An open PR's colour: red when something blocks it, yellow while checks run, green otherwise.
// The reason names the blockers first, then what it waits on.
function pullRequestReadiness(pr: PullRequestReadiness) {
  const failing = pr.checks === 'failure'
  const changes = pr.reviewDecision === 'CHANGES_REQUESTED'
  const conflict = pr.mergeable === 'CONFLICTING'
  const running = pr.checks === 'pending'
  const reasons = [
    failing &&
      (pr.failingChecks
        ? `${pr.failingChecks} ${pr.failingChecks === 1 ? 'check' : 'checks'} failing`
        : 'Checks failing'),
    changes && 'Changes requested',
    conflict && 'Merge conflict',
    running && 'Checks running',
    pr.reviewDecision === 'REVIEW_REQUIRED' && 'Waiting for review',
  ].filter(Boolean)
  return {
    color:
      failing || changes || conflict
        ? 'text-status-error'
        : running
          ? 'text-pr-running'
          : 'text-pr-open',
    reason: reasons.join(' · ') || 'Ready to merge',
  }
}

// A link's state is unknown until GitHub has been read once. An open PR is labelled by its readiness.
export function linkPresentation(
  pr?: PullRequestReadiness & { state?: keyof typeof prPresentation }
) {
  if (!pr?.state)
    return { ...prPresentation.open, label: 'Pull request', color: 'text-muted-foreground' }
  if (pr.state !== 'open') return prPresentation[pr.state]
  const { color, reason } = pullRequestReadiness(pr)
  return { ...prPresentation.open, color, label: reason }
}

// In-flight PRs lead, matching how the app ranks a thread's PRs; blocked ones lead the open.
const stateOrder: ThreadPullRequest['state'][] = ['open', 'draft', 'merged', 'closed']
const readinessOrder = ['text-status-error', 'text-pr-running', 'text-pr-open']

// A thread's PRs as its row and hover card show them: a count per glyph and colour, even for one,
// so readiness splits the open count. The tooltip lists each PR's readiness.
export function PullRequestMark({
  pullRequests,
  tooltip = true,
}: {
  pullRequests: readonly ThreadPullRequest[]
  tooltip?: boolean
}) {
  const looks = pullRequests
    .map((pr) => ({ pr, ...linkPresentation(pr) }))
    .toSorted(
      (a, b) =>
        stateOrder.indexOf(a.pr.state) - stateOrder.indexOf(b.pr.state) ||
        readinessOrder.indexOf(a.color) - readinessOrder.indexOf(b.color)
    )
  const groups: ((typeof looks)[number] & { count: number })[] = []
  for (const look of looks) {
    const group = groups.find((existing) => existing.color === look.color)
    if (group) group.count++
    else groups.push({ ...look, count: 1 })
  }

  const mark = (
    <>
      {groups.map(({ icon: Icon, color, count }) => (
        <span key={color} className={cn('flex items-center gap-1', color)}>
          <Icon aria-hidden='true' className='size-3' />
          <span className='font-mono'>{count}</span>
        </span>
      ))}
      <span className='sr-only'>
        {looks.map(({ pr, label }) => `#${pr.number} ${label}`).join(', ')}
      </span>
    </>
  )
  const className = 'flex shrink-0 items-center gap-1.5'
  if (!tooltip) return <span className={className}>{mark}</span>
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} />}>{mark}</TooltipTrigger>
      <TooltipContent>
        <span className='flex flex-col'>
          {looks.map(({ pr, label }) => (
            <span key={`${pr.repo}#${pr.number}`}>
              <span className='font-mono'>#{pr.number}</span> {label}
            </span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
