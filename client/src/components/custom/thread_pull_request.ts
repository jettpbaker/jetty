import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from '@primer/octicons-react'

export const prPresentation = {
  draft: { icon: GitPullRequestDraftIcon, label: 'Draft', color: 'text-pr-draft' },
  open: { icon: GitPullRequestIcon, label: 'Open', color: 'text-pr-open' },
  merged: { icon: GitMergeIcon, label: 'Merged', color: 'text-pr-merged' },
  closed: { icon: GitPullRequestClosedIcon, label: 'Closed', color: 'text-pr-closed' },
}

export function pullRequestLabel(pullRequest: ThreadPullRequest) {
  const pr = prPresentation[pullRequest.state]
  return pullRequest.count > 1
    ? {
        text: `${pullRequest.count} PRs`,
        title: `${pr.label} PR #${pullRequest.number} · most recently updated`,
      }
    : { text: `#${pullRequest.number}`, title: `${pr.label} PR #${pullRequest.number}` }
}

export type ThreadPullRequest = {
  repo: string
  number: number
  state: keyof typeof prPresentation
  count: number
}

// A link's state is unknown until GitHub has been read once.
export function linkPresentation(state?: keyof typeof prPresentation) {
  return state
    ? prPresentation[state]
    : { ...prPresentation.open, label: 'Pull request', color: 'text-muted-foreground' }
}
