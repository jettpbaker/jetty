import type { PullRequestData } from '@jetty/shared/pull-request'

import {
  checkSummary,
  displayedRollupState,
  pullRequestState,
  rollupChecks,
} from '@jetty/shared/pull-request'

export type GitHubPullRequest = PullRequestData['pull']
export type GitHubUser = GitHubPullRequest['user']

// A fetched PR's state and readiness, as a thread's link to it carries them.
export function pullRequestFacts(data: PullRequestData) {
  const summary = checkSummary(data.checkRuns)
  return {
    state: pullRequestState(data.pull),
    checks:
      rollupChecks[
        displayedRollupState(
          summary,
          data.checkRollupState ?? '',
          data.truncatedConnections?.includes('checkRuns') === true
        )
      ],
    failingChecks: summary.failed,
    reviewDecision: data.reviewDecision,
    mergeable: data.mergeable,
    mergeStateStatus: data.mergeStateStatus,
    baseRef: data.pull.base.ref,
    reviewRequestCount: data.reviewRequests?.length,
  }
}
