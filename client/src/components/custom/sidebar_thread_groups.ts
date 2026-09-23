import type { ProjectIcon, ProviderId } from '@jetty/shared/wire'

import type { ThreadPullRequest } from './thread_pull_request'
import type { ThreadStatus } from './thread_status'

export type ThreadGrouping = 'project' | 'status' | 'date'

export type SidebarThread = {
  id: string
  title: string
  project: string
  projectIcon?: ProjectIcon
  parent?: string
  status: ThreadStatus
  lastActivity: string
  updatedAt: number
  pinned: boolean
  archived: boolean
  pullRequest?: ThreadPullRequest
  provider?: ProviderId
  model?: string
  effort?: string
}

const statusGroups = [
  { id: 'needs-attention', label: 'Needs input' },
  { id: 'ready', label: 'Ready for review' },
  { id: 'error', label: 'Error' },
  { id: 'working', label: 'Working' },
  { id: 'idle', label: 'Idle' },
] as const

const dateGroups = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'earlier', label: 'Earlier' },
] as const

function startOfLocalDay(date: Date, dayOffset = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset).getTime()
}

function startOfMondayWeek(date: Date, weekOffset = 0) {
  const daysFromMonday = date.getDay() === 0 ? 6 : date.getDay() - 1
  return startOfLocalDay(date, -daysFromMonday + weekOffset * 7)
}

function dateGroupId(updatedAt: number, now: Date) {
  if (updatedAt >= startOfLocalDay(now)) return 'today'
  if (updatedAt >= startOfLocalDay(now, -1)) return 'yesterday'
  if (updatedAt >= startOfMondayWeek(now)) return 'this-week'
  if (updatedAt >= startOfMondayWeek(now, -1)) return 'last-week'
  return 'earlier'
}

function groupsFor(grouping: ThreadGrouping, threads: SidebarThread[]) {
  if (grouping === 'project')
    return [...new Set(threads.map((thread) => thread.project))]
      .sort((a, b) => a.localeCompare(b))
      .map((project) => ({ id: project, label: project }))
  if (grouping === 'status') return statusGroups
  return dateGroups
}

function threadInGroup(
  thread: SidebarThread,
  grouping: ThreadGrouping,
  groupId: string,
  now: Date
) {
  if (grouping === 'project') return thread.project === groupId
  if (grouping === 'status') return thread.status === groupId
  return dateGroupId(thread.updatedAt, now) === groupId
}

export function groupSidebarThreads(
  threads: SidebarThread[],
  grouping: ThreadGrouping,
  query: string,
  showPinned: boolean,
  showArchived: boolean
) {
  const now = new Date()
  const search = query.trim().toLowerCase()
  const matching = threads
    .filter((thread) => `${thread.title} ${thread.project}`.toLowerCase().includes(search))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const filtered = matching.filter((thread) => !thread.archived)
  const remaining = showPinned ? filtered.filter((thread) => !thread.pinned) : filtered
  const grouped = groupsFor(grouping, remaining).map((group) => ({
    id: `${grouping}:${group.id}`,
    label: group.label,
    pinned: false,
    archived: false,
    threads: remaining.filter((thread) => threadInGroup(thread, grouping, group.id, now)),
  }))
  return [
    ...(showPinned
      ? [
          {
            id: 'pinned',
            label: 'Pinned',
            pinned: true,
            archived: false,
            threads: filtered.filter((thread) => thread.pinned),
          },
        ]
      : []),
    ...grouped,
    ...(showArchived
      ? [
          {
            id: 'archived',
            label: 'Archived',
            pinned: false,
            archived: true,
            threads: matching.filter((thread) => thread.archived),
          },
        ]
      : []),
  ].filter((group) => group.threads.length > 0)
}
