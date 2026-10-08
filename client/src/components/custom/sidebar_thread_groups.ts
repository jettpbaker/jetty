import type { SidebarList, SidebarRow } from '@/state/sidebar'
import type { ProjectIcon, PullRequestLink } from '@jetty/shared/wire'

import { formatAge, formatElapsed } from '@/lib/time'

import type { ThreadPullRequest } from './thread_pull_request'

import { statusPresentation, threadStatus, type ThreadStatus } from './thread_status'

export type ThreadGrouping = 'project' | 'status' | 'date' | 'bot'

export type SidebarThread = {
  id: string
  title: string
  project: string
  projectIcon?: ProjectIcon
  status: ThreadStatus
  lastActivity: string
  pinned: boolean
  archived: boolean
  pullRequests: ThreadPullRequest[]
  // The one a click opens: the PR still in flight, newest first within a state.
  pullRequest?: ThreadPullRequest
}

export function sidebarThread({ thread, project }: SidebarRow, now: number): SidebarThread {
  return {
    id: thread.id,
    title: thread.title,
    project: project?.title ?? '',
    projectIcon: project?.icon,
    status: threadStatus(thread.status, thread.readyForReview),
    lastActivity:
      thread.status === 'monitoring' && thread.backgroundTasks?.length
        ? formatElapsed(now - Math.min(...thread.backgroundTasks.map((task) => task.startedAt)))
        : formatAge(thread.updatedAt, now),
    pinned: thread.pinned,
    archived: thread.archived,
    ...threadPullRequests(thread.pullRequests ?? []),
  }
}

const stateRank = { open: 0, draft: 1, merged: 2, closed: 3 }

// Only links GitHub has resolved count; a pending or not-found one mustn't hide the rest.
// The PR still in flight represents the thread when clicked, newest first within a state.
export function threadPullRequests(links: readonly PullRequestLink[]) {
  const resolved = links.flatMap((link) => (link.state ? [{ ...link, state: link.state }] : []))
  const latest = resolved.reduce<(typeof resolved)[number] | undefined>((best, link) => {
    if (!best) return link
    const rank = stateRank[link.state] - stateRank[best.state]
    if (rank !== 0) return rank < 0 ? link : best
    return (link.updatedAt ?? link.linkedAt) > (best.updatedAt ?? best.linkedAt) ? link : best
  }, undefined)
  return { pullRequests: resolved, pullRequest: latest }
}

const statusGroups = (
  ['needs-attention', 'ready', 'error', 'working', 'monitoring', 'idle'] as const
).map((id) => ({ id, label: statusPresentation[id].label }))

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

function groupsFor(grouping: ThreadGrouping, threads: ListedThread[], bots: SidebarList['bots']) {
  // By id: two checkouts can share a folder name and still be different projects.
  if (grouping === 'project')
    return [...new Map(threads.map((thread) => [thread.projectId, thread.project])).entries()]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([id, label]) => ({ id, label }))
  if (grouping === 'status') return statusGroups
  if (grouping === 'bot')
    return [...bots.map(({ id, name }) => ({ id, label: name })), { id: '', label: 'No bot' }]
  return dateGroups
}

function threadInGroup(thread: ListedThread, grouping: ThreadGrouping, groupId: string, now: Date) {
  if (grouping === 'project') return thread.projectId === groupId
  if (grouping === 'status') return thread.status === groupId
  if (grouping === 'bot') return (thread.botId ?? '') === groupId
  return dateGroupId(thread.updatedDay, now) === groupId
}

type ThreadListView = {
  grouping: ThreadGrouping
  query: string
  showPinned: boolean
  showArchived: boolean
  showQuiet: boolean
}

function listedThreads({ threads, projects, bots }: SidebarList) {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const botIds = new Set(bots.map((bot) => bot.id))
  return threads.map((thread) => ({
    ...thread,
    project: byId.get(thread.projectId)?.title ?? '',
    projectIcon: byId.get(thread.projectId)?.icon,
    status: threadStatus(thread.status, thread.readyForReview),
    // A bot the Bots section doesn't list has no group, so its threads go with No bot.
    botId: thread.botId && botIds.has(thread.botId) ? thread.botId : undefined,
  }))
}

type ListedThread = ReturnType<typeof listedThreads>[number]

function groupSidebarThreads(
  threads: ListedThread[],
  bots: SidebarList['bots'],
  { grouping, query, showPinned, showArchived, showQuiet }: ThreadListView,
  now: Date
) {
  const search = query.trim().toLowerCase()
  const matching = threads
    .filter((thread) => `${thread.title} ${thread.project}`.toLowerCase().includes(search))
    // A quiet thread lists only when asked for: the switch, or a search that finds it.
    .filter((thread) => !thread.quiet || showQuiet || search)
    .sort((a, b) => b.lastStartedAt - a.lastStartedAt)
  const filtered = matching.filter((thread) => !thread.archived && !thread.quiet)
  const remaining = showPinned ? filtered.filter((thread) => !thread.pinned) : filtered
  const grouped = groupsFor(grouping, remaining, bots).map((group) => ({
    id: `${grouping}:${group.id}`,
    label: group.label,
    pinned: false,
    archived: false,
    quiet: false,
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
            quiet: false,
            threads: filtered.filter((thread) => thread.pinned),
          },
        ]
      : []),
    ...grouped,
    {
      id: 'quiet',
      label: 'Quiet',
      pinned: false,
      archived: false,
      quiet: true,
      threads: matching.filter((thread) => thread.quiet && !thread.archived),
    },
    ...(showArchived
      ? [
          {
            id: 'archived',
            label: 'Archived',
            pinned: false,
            archived: true,
            quiet: false,
            threads: matching.filter((thread) => thread.archived),
          },
        ]
      : []),
  ].filter((group) => group.threads.length > 0)
}

// The list as groups of thread ids: rows read their own threads.
export function sidebarGroups(list: SidebarList, view: ThreadListView, now: number) {
  return groupSidebarThreads(listedThreads(list), list.bots, view, new Date(now)).map(
    ({ threads, ...group }) => ({
      ...group,
      status:
        !group.pinned && !group.archived && !group.quiet && view.grouping === 'status'
          ? threads[0]?.status
          : undefined,
      projectIcon: threads[0]?.projectIcon,
      botId: threads[0]?.botId,
      threads: threads.map((thread) => thread.id),
    })
  )
}
