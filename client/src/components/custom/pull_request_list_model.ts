import type { PullRequestListItem, PullRequestListTab } from '@jetty/shared/wire'

import { storage } from '@/platform'

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

const tabKey = 'jetty.pullRequests.tab'

export function rememberPullRequestTab(tab: PullRequestListTab) {
  storage.set(tabKey, tab)
}

// Pull requests open on the tab you last chose.
export function pullRequestListSearch(): { tab?: 'created' } {
  return storage.get(tabKey) === 'created' ? { tab: 'created' } : {}
}
