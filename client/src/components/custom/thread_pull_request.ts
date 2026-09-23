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

export type ThreadPullRequest = { number: number; state: keyof typeof prPresentation }
