import type { PullRequestListItem, PullRequestListTab } from '@jetty/shared/wire'

import { storage } from '@/platform'

import { pullRequestReadinessGroup, type PullRequestReadinessGroup } from './thread_pull_request'

export type PullRequestGroup = PullRequestListItem['state']
export const pullRequestGroupOrder: PullRequestGroup[] = ['open', 'draft', 'merged', 'closed']
export const pullRequestGroupLabel: Record<PullRequestGroup, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Recently merged',
  closed: 'Closed',
}

export type PullRequestListGroup = PullRequestReadinessGroup | Exclude<PullRequestGroup, 'open'>
export const pullRequestReadinessOrder: PullRequestListGroup[] = [
  'ready',
  'needs-you',
  'in-review',
  'running',
  'draft',
  'merged',
  'closed',
]
export const pullRequestReadinessLabel: Record<PullRequestListGroup, string> = {
  ready: 'Ready to merge',
  'needs-you': 'Needs you',
  'in-review': 'In review',
  running: 'Checks running',
  draft: 'Draft',
  merged: 'Recently merged',
  closed: 'Closed',
}

export function pullRequestListGroup(pull: PullRequestListItem): PullRequestListGroup {
  return pull.state === 'open' ? pullRequestReadinessGroup(pull) : pull.state
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
