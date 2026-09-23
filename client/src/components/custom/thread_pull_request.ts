import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from '@primer/octicons-react'

export type ThreadPullRequest = {
  number: number
  status: 'draft' | 'open' | 'merged' | 'closed'
  updatedAt: number
}

export const prPresentation = {
  draft: { icon: GitPullRequestDraftIcon, label: 'Draft', color: 'text-pr-draft' },
  open: { icon: GitPullRequestIcon, label: 'Open', color: 'text-pr-open' },
  merged: { icon: GitMergeIcon, label: 'Merged', color: 'text-pr-merged' },
  closed: { icon: GitPullRequestClosedIcon, label: 'Closed', color: 'text-pr-closed' },
}

export function latestPullRequest(pullRequests: readonly ThreadPullRequest[]) {
  return pullRequests.reduce<ThreadPullRequest | undefined>(
    (latest, pr) => (!latest || pr.updatedAt > latest.updatedAt ? pr : latest),
    undefined
  )
}
