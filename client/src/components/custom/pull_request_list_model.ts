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
    pull.mergeStateStatus === 'DIRTY' ||
    pull.mergeStateStatus === 'BEHIND'
  )
    return 'attention'
  if (
    pull.state === 'open' &&
    (pull.mergeStateStatus === 'CLEAN' ||
      pull.mergeStateStatus === 'HAS_HOOKS' ||
      pull.mergeStateStatus === 'UNSTABLE')
  )
    return 'ready'
  return 'waiting'
}

export function pullRequestIdentifier(pull: PullRequestListItem) {
  return `${pull.repo.split('/').at(-1)}#${pull.number}`
}

export function pullRequestReason(pull: PullRequestListItem) {
  if (pull.state !== 'open') return pull.state
  if (pullRequestGroup(pull) === 'ready') return 'Ready to merge'
  if (pull.mergeStateStatus === 'DIRTY') return 'Merge conflicts'
  if (pull.mergeStateStatus === 'BEHIND') return 'Branch is out of date'
  if (pull.checks === 'failure') return 'Checks failing'
  if (pull.reviewDecision === 'CHANGES_REQUESTED') return 'Changes requested'
  if (pull.checks === 'pending') return 'Checks running'
  if (pull.reviewDecision === 'REVIEW_REQUIRED') return 'Review required'
  if (pull.mergeStateStatus === 'BLOCKED') return 'Blocked by branch protection'
  return 'Checking mergeability'
}
