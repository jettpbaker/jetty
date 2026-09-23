import type { SidebarThread } from './app_sidebar'

export type ThreadGrouping = 'project' | 'status' | 'date'

const statusGroups = [
  { id: 'needs-attention', label: 'Needs input' },
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
  now = new Date()
) {
  const search = query.trim().toLowerCase()
  const filtered = threads
    .filter((thread) => `${thread.title} ${thread.project}`.toLowerCase().includes(search))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const remaining = showPinned ? filtered.filter((thread) => !thread.pinned) : filtered
  const grouped = groupsFor(grouping, remaining).map((group) => ({
    id: `${grouping}:${group.id}`,
    label: group.label,
    pinned: false,
    threads: remaining.filter((thread) => threadInGroup(thread, grouping, group.id, now)),
  }))
  return [
    ...(showPinned
      ? [
          {
            id: 'pinned',
            label: 'Pinned',
            pinned: true,
            threads: filtered.filter((thread) => thread.pinned),
          },
        ]
      : []),
    ...grouped,
  ].filter((group) => group.threads.length > 0)
}
