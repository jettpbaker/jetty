import type { Chrome } from '@/state'
import type { ProjectIcon, ProviderId, PullRequestLink } from '@jetty/shared/wire'

import { effortLabels } from '@/lib/loadout'
import { formatAge, formatElapsed } from '@/lib/time'
import { catalogModelName } from '@jetty/shared/model-name'

import type { ThreadPullRequest } from './thread_pull_request'

import { statusPresentation, threadStatus, type ThreadStatus } from './thread_status'

export type ThreadGrouping = 'project' | 'status' | 'date'

export type SidebarThread = {
  id: string
  title: string
  project: string
  projectId: string
  projectIcon?: ProjectIcon
  parent?: string
  status: ThreadStatus
  lastActivity: string
  environment: 'local' | 'worktree'
  branch?: string
  updatedAt: number
  pinned: boolean
  archived: boolean
  pullRequests: ThreadPullRequest[]
  // The one a click opens: the PR still in flight, newest first within a state.
  pullRequest?: ThreadPullRequest
  provider?: ProviderId
  model?: string
  effort?: string
}

export function sidebarThreads(
  chrome: Chrome,
  now: number,
  threads = chrome.threads
): SidebarThread[] {
  const projects = new Map(chrome.projects.map((project) => [project.id, project]))
  const titles = new Map(chrome.threads.map((thread) => [thread.id, thread.title]))
  return threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    project: projects.get(thread.projectId)?.title ?? '',
    projectId: thread.projectId,
    projectIcon: projects.get(thread.projectId)?.icon,
    parent: thread.parentThreadId && titles.get(thread.parentThreadId),
    status: threadStatus(thread.status, thread.readyForReview),
    lastActivity:
      thread.status === 'monitoring' && thread.backgroundTasks?.length
        ? formatElapsed(now - Math.min(...thread.backgroundTasks.map((task) => task.startedAt)))
        : formatAge(thread.updatedAt, now),
    environment: thread.environment,
    branch: thread.git?.branch ?? thread.worktree?.branch ?? undefined,
    updatedAt: thread.updatedAt,
    pinned: thread.pinned,
    archived: thread.archived,
    ...threadPullRequests(thread.pullRequests ?? []),
    provider: thread.provider,
    model:
      thread.provider && thread.model
        ? catalogModelName(chrome.models, thread.provider, thread.model)
        : undefined,
    effort: thread.effort && effortLabels[thread.effort],
  }))
}

const stateRank = { open: 0, draft: 1, merged: 2, closed: 3 }

// Only links GitHub has resolved count; a pending or not-found one mustn't hide the rest.
// The PR still in flight represents the thread when clicked, newest first within a state.
function threadPullRequests(links: readonly PullRequestLink[]) {
  const resolved = links.flatMap((link) =>
    link.state
      ? [
          {
            repo: link.repo,
            number: link.number,
            state: link.state,
            at: link.updatedAt ?? link.linkedAt,
          },
        ]
      : []
  )
  const latest = resolved.reduce<(typeof resolved)[number] | undefined>((best, link) => {
    if (!best) return link
    const rank = stateRank[link.state] - stateRank[best.state]
    if (rank !== 0) return rank < 0 ? link : best
    return link.at > best.at ? link : best
  }, undefined)
  return {
    pullRequests: resolved.map(({ repo, number, state }) => ({ repo, number, state })),
    pullRequest: latest && { repo: latest.repo, number: latest.number, state: latest.state },
  }
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
