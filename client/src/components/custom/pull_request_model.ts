import type { PullRequestData } from '@jetty/shared/pull-request'

import { failedCheckConclusions, rollupChecks } from '@jetty/shared/pull-request'

export type GitHubPullRequest = PullRequestData['pull']
export type GitHubUser = GitHubPullRequest['user']
export function pullRequestState(
  pull: Pick<GitHubPullRequest, 'merged' | 'state' | 'draft'>
): 'draft' | 'open' | 'merged' | 'closed' {
  if (pull.merged) return 'merged'
  if (pull.state === 'closed') return 'closed'
  if (pull.draft) return 'draft'
  return 'open'
}

// A fetched PR's state and readiness, as a thread's link to it carries them.
export function pullRequestFacts(data: PullRequestData) {
  return {
    state: pullRequestState(data.pull),
    checks: rollupChecks[data.checkRollupState ?? ''],
    failingChecks: data.checkRuns.filter((run) =>
      failedCheckConclusions.includes(run.conclusion ?? '')
    ).length,
    reviewDecision: data.reviewDecision,
    mergeable: data.mergeable,
    mergeStateStatus: data.mergeStateStatus,
    baseRef: data.pull.base.ref,
    reviewRequestCount: data.reviewRequests?.length,
  }
}
