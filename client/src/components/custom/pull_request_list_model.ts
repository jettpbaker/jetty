import type { PullRequestListItem } from '@jetty/shared/wire'

export type PullRequestGroup = 'ready' | 'attention' | 'waiting' | 'draft' | 'closed'
export const pullRequestGroupOrder: PullRequestGroup[] = [
  'ready',
  'attention',
  'waiting',
  'draft',
  'closed',
]
export const pullRequestGroupLabel: Record<PullRequestGroup, string> = {
  ready: 'Ready to merge',
  attention: 'Needs attention',
  waiting: 'Waiting on review',
  draft: 'Draft',
  closed: 'Recently closed / merged',
}

export function pullRequestGroup(pull: PullRequestListItem): PullRequestGroup {
  if (pull.state === 'merged' || pull.state === 'closed') return 'closed'
  if (pull.state === 'draft') return 'draft'
  if (
    pull.checks === 'failure' ||
    pull.reviewDecision === 'CHANGES_REQUESTED' ||
    pull.mergeable === 'CONFLICTING'
  )
    return 'attention'
  if (
    pull.reviewDecision === 'APPROVED' &&
    pull.checks === 'success' &&
    pull.mergeable === 'MERGEABLE'
  )
    return 'ready'
  return 'waiting'
}

export function pullRequestIdentifier(pull: PullRequestListItem) {
  return `${pull.repo.split('/').at(-1)}#${pull.number}`
}

export function pullRequestReason(pull: PullRequestListItem) {
  if (pull.state !== 'open') return pull.state
  if (pull.mergeable === 'CONFLICTING') return 'Merge conflicts'
  if (pull.checks === 'failure') return 'Checks failing'
  if (pull.reviewDecision === 'CHANGES_REQUESTED') return 'Changes requested'
  if (pull.checks === 'pending') return 'Checks running'
  if (pull.reviewDecision === 'REVIEW_REQUIRED') return 'Review required'
  return pull.mergeable === 'MERGEABLE' ? 'Ready to merge' : 'Checking mergeability'
}

export function formatRelativeDate(iso: string, now = Date.now()) {
  const elapsed = Math.max(0, now - new Date(iso).getTime())
  const minutes = Math.round(elapsed / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso))
}
