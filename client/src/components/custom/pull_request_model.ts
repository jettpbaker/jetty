import type { PullRequestData } from '@jetty/shared/pull-request'

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
