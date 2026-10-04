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
