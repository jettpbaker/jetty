import type { PullRequestListItem } from '@jetty/shared/wire'

export type PullRequestGroup = PullRequestListItem['state']
export const pullRequestGroupOrder: PullRequestGroup[] = ['open', 'draft', 'merged', 'closed']
export const pullRequestGroupLabel: Record<PullRequestGroup, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Recently merged',
  closed: 'Closed',
}

export function pullRequestIdentifier(pull: PullRequestListItem) {
  return `${pull.repo.split('/').at(-1)}#${pull.number}`
}

// What a row's check and review glyphs say, for its accessible label.
export function pullRequestSignals(pull: PullRequestListItem) {
  return [
    pull.checks === 'failure' && 'checks failing',
    pull.checks === 'pending' && 'checks running',
    pull.state === 'open' && pull.mergeable === 'CONFLICTING' && 'merge conflicts',
    pull.reviewDecision === 'APPROVED' && 'approved',
    pull.reviewDecision === 'CHANGES_REQUESTED' && 'changes requested',
  ].filter(Boolean)
}
