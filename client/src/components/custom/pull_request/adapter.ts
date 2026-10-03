import type { PullRequestData } from '@jetty/shared/pull-request'
import type { FileDiffContentsLoader } from '@pierre/diffs'

import { pullRequestState } from '../pull_request_model'

export type PrUser = { login: string; name: string | null; avatarUrl: string }
export type PrCheck = {
  id: string | number
  kind: 'run' | 'status'
  name: string
  workflow: string | null
  event: string | null
  status: PullRequestData['checkRuns'][number]['status']
  conclusion: PullRequestData['checkRuns'][number]['conclusion']
  startedAt: string | null
  completedAt: string | null
  description?: string
  required: boolean
  url: string
  app: string
}
export type PrFile = {
  path: string
  previousPath?: string
  status: PullRequestData['files'][number]['status']
  additions: number
  deletions: number
  changes: number
  patch?: string
  binary: boolean
  generated: boolean
  viewed: boolean
}
export type PrComment = { id: number; author: PrUser; body: string; createdAt: string; url: string }
export type PrThread = {
  id: string
  path: string
  line: number | null
  startLine: number | null
  side: 'LEFT' | 'RIGHT'
  resolved: boolean
  outdated: boolean
  diffHunk: string
  comments: PrComment[]
}
export type PrReview = {
  id: number
  author: PrUser
  state: string
  body: string
  submittedAt: string
}
export type PrCommit = {
  sha: string
  message: string
  author: string
  date: string
  parents: number
}
export type PrStatusEvent = {
  kind: NonNullable<PullRequestData['statusEvents']>[number]['kind']
  actor: PrUser
  at: string
}
export type PrMergeMethod = PullRequestData['viewerDefaultMergeMethod']
export type PrPull = {
  number: number
  title: string
  body: string
  url: string
  state: ReturnType<typeof pullRequestState>
  author: PrUser
  viewer?: PrUser
  base: string
  head: string
  createdAt: string
  mergedAt: string | null
  mergedBy: PrUser | null
  openedAsDraft: boolean
  statusEvents: PrStatusEvent[]
  mergeMethods: PrMergeMethod[]
  viewerDefaultMergeMethod: PrMergeMethod
  issues: {
    number: number
    title: string
    url: string
    state: 'open' | 'completed' | 'not_planned'
  }[]
  references: NonNullable<PullRequestData['references']>[number][]
  checks: PrCheck[]
  files: PrFile[]
  threads: PrThread[]
  reviews: PrReview[]
  conversation: PrComment[]
  commits: PrCommit[]
  reviewers: { user: PrUser; state: string; team?: { codeOwner: boolean } }[]
  data: PullRequestData
}
export type LoadPrDiff = FileDiffContentsLoader

export function prUser(user: PullRequestData['pull']['user']): PrUser {
  return { login: user.login, name: user.name ?? null, avatarUrl: user.avatar_url }
}
export function githubUser(user: PrUser): PullRequestData['pull']['user'] {
  return {
    login: user.login,
    avatar_url: user.avatarUrl,
    html_url: `https://github.com/${user.login}`,
    ...(user.name ? { name: user.name } : {}),
  }
}
export function prFile(file: PullRequestData['files'][number]): PrFile {
  return {
    path: file.filename,
    previousPath: file.previous_filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch,
    binary: file.binary === true,
    generated: file.generated === true,
    viewed: file.viewed === 'VIEWED',
  }
}
export function adaptPullRequest(data: PullRequestData): PrPull {
  const pull = data.pull
  const threads = new Map<string, PrThread>()
  const roots = new Map(data.reviewComments.map((comment) => [comment.id, comment]))
  for (const comment of data.reviewComments) {
    let root = comment
    const seen = new Set<number>()
    while (root.in_reply_to_id !== undefined && !seen.has(root.id)) {
      seen.add(root.id)
      root = roots.get(root.in_reply_to_id) ?? root
      if (seen.has(root.id)) break
    }
    const id = root.thread_id ?? comment.thread_id ?? `comment:${root.id}`
    let thread = threads.get(id)
    if (!thread) {
      thread = {
        id,
        path: root.path,
        line: root.line,
        startLine: root.start_line ?? null,
        side: root.side ?? 'RIGHT',
        resolved: root.resolved === true,
        outdated: root.outdated === true,
        diffHunk: root.diff_hunk ?? '',
        comments: [],
      }
      threads.set(id, thread)
    }
    thread.comments.push({
      id: comment.id,
      author: prUser(comment.user),
      body: comment.body,
      createdAt: comment.created_at,
      url: comment.html_url,
    })
  }
  const methods: PrMergeMethod[] = []
  if (data.mergeCommitAllowed) methods.push('MERGE')
  if (data.squashMergeAllowed) methods.push('SQUASH')
  if (data.rebaseMergeAllowed) methods.push('REBASE')
  return {
    number: pull.number,
    title: pull.title,
    body: pull.body,
    url: pull.html_url,
    state: pullRequestState(pull),
    author: prUser(pull.user),
    viewer: data.viewer && prUser(data.viewer),
    base: pull.base.ref,
    head: pull.head.ref,
    createdAt: pull.created_at,
    mergedAt: pull.merged_at,
    mergedBy: pull.merged_by ? prUser(pull.merged_by) : null,
    openedAsDraft: data.openedAsDraft ?? pull.draft,
    statusEvents: (data.statusEvents ?? []).map((event) => ({
      ...event,
      actor: event.actor ? prUser(event.actor) : { login: 'ghost', name: null, avatarUrl: '' },
    })),
    mergeMethods: methods,
    viewerDefaultMergeMethod: data.viewerDefaultMergeMethod,
    issues: data.closingIssuesReferences.map((issue) => ({
      ...issue,
      state: issue.state ?? 'open',
    })),
    references: [...(data.references ?? [])],
    checks: data.checkRuns.map((check) => ({
      id: check.id,
      kind: check.kind ?? 'run',
      name: check.name,
      workflow: check.workflow ?? null,
      event: check.event ?? null,
      status: check.status,
      conclusion: check.conclusion,
      startedAt: check.started_at || null,
      completedAt: check.completed_at,
      description: check.description ?? undefined,
      required: check.required === true,
      url: check.html_url,
      app: check.app.name,
    })),
    files: data.files.map(prFile),
    threads: [...threads.values()].map((thread) => ({
      ...thread,
      comments: thread.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    })),
    reviews: data.reviews
      .filter((review) => review.state !== 'PENDING')
      .map((review) => ({
        id: review.id,
        author: prUser(review.user),
        state: review.state,
        body: review.body,
        submittedAt: review.submitted_at,
      })),
    conversation: (data.issueComments ?? []).map((comment) => ({
      id: comment.id,
      author: prUser(comment.user),
      body: comment.body,
      createdAt: comment.created_at,
      url: comment.html_url,
    })),
    commits: data.commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.author
        ? (prUser(commit.author).name ?? commit.author.login)
        : commit.commit.author.name,
      date: commit.commit.author.date,
      parents: commit.parents ?? 1,
    })),
    reviewers: (data.reviewers ?? data.reviewRequests ?? [])
      .filter((reviewer) => reviewer.state !== 'PENDING')
      .map((reviewer) => ({
        user: prUser(reviewer),
        state: reviewer.requested
          ? 'REQUESTED'
          : reviewer.state === 'DISMISSED'
            ? 'DISMISSED'
            : (reviewer.latestReviewState ?? reviewer.state ?? 'COMMENTED'),
        ...(reviewer.kind === 'team' ? { team: { codeOwner: reviewer.asCodeOwner } } : {}),
      })),
    data,
  }
}
