import type { PullRequestData } from '@jetty/shared/pull-request'

export type GitHubPullRequest = PullRequestData['pull']
export type GitHubUser = GitHubPullRequest['user']
export type GitHubReview = PullRequestData['reviews'][number]
export type GitHubReviewComment = PullRequestData['reviewComments'][number]
export type GitHubCheckRun = PullRequestData['checkRuns'][number]
export type GitHubCommit = PullRequestData['commits'][number]
export type GitHubFile = PullRequestData['files'][number]
export type ClosingIssueReference = PullRequestData['closingIssuesReferences'][number]
export type MergeMethod = PullRequestData['viewerDefaultMergeMethod']

export type ReviewThread = {
  id: number
  path: string
  line: number | null
  comments: GitHubReviewComment[]
  resolved: boolean
}

export function pullRequestState(
  pull: Pick<GitHubPullRequest, 'merged' | 'state' | 'draft'>
): 'draft' | 'open' | 'merged' | 'closed' {
  if (pull.merged) return 'merged'
  if (pull.state === 'closed') return 'closed'
  if (pull.draft) return 'draft'
  return 'open'
}

export type PrActivityItem =
  | { kind: 'commits'; id: string; at: string; commits: GitHubCommit[] }
  | { kind: 'review'; id: string; at: string; review: GitHubReview }
  | { kind: 'thread'; id: string; at: string; thread: ReviewThread }
  | { kind: 'merged'; id: string; at: string; user: GitHubUser }

function includeReview(review: GitHubReview) {
  if (review.state === 'PENDING') return false
  if (review.state === 'COMMENTED' && !review.body.trim()) return false
  return true
}

function commitAuthorKey(commit: GitHubCommit) {
  return commit.author?.login ?? commit.commit.author.name
}

export function prActivity(
  data: Pick<PullRequestData, 'pull' | 'reviews' | 'reviewComments' | 'commits'>
): PrActivityItem[] {
  const events: Array<
    PrActivityItem | { kind: 'commit'; id: string; at: string; commit: GitHubCommit }
  > = [
    ...data.commits.map((commit) => ({
      kind: 'commit' as const,
      id: `commit:${commit.sha}`,
      at: commit.commit.author.date,
      commit,
    })),
    ...data.reviews.filter(includeReview).map((review) => ({
      kind: 'review' as const,
      id: `review:${review.id}`,
      at: review.submitted_at,
      review,
    })),
    ...reviewThreads(data.reviewComments).flatMap((thread) => {
      const first = thread.comments[0]
      if (!first) return []
      const at = thread.comments.reduce(
        (earliest, comment) => (comment.created_at < earliest ? comment.created_at : earliest),
        first.created_at
      )
      return [{ kind: 'thread' as const, id: `thread:${thread.id}`, at, thread }]
    }),
  ]
  if (data.pull.merged && data.pull.merged_at) {
    events.push({ kind: 'merged', id: 'merged', at: data.pull.merged_at, user: data.pull.user })
  }
  events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))

  const items: PrActivityItem[] = []
  for (const event of events) {
    if (event.kind !== 'commit') {
      items.push(event)
      continue
    }
    const previous = items.at(-1)
    const lead = previous?.kind === 'commits' ? previous.commits[0] : undefined
    if (
      previous?.kind === 'commits' &&
      lead &&
      commitAuthorKey(lead) === commitAuthorKey(event.commit)
    ) {
      previous.commits.push(event.commit)
      previous.at = event.at
      previous.id = `commits:${lead.sha}:${event.commit.sha}`
      continue
    }
    items.push({
      kind: 'commits',
      id: `commits:${event.commit.sha}`,
      at: event.at,
      commits: [event.commit],
    })
  }
  return items
}

export function reviewThreads(comments: readonly GitHubReviewComment[]): ReviewThread[] {
  const byId = new Map<number, GitHubReviewComment>()
  for (const comment of comments) byId.set(comment.id, comment)

  function rootId(comment: GitHubReviewComment) {
    let current = comment
    const seen = new Set<number>()
    while (current.in_reply_to_id !== undefined && !seen.has(current.id)) {
      seen.add(current.id)
      const parent = byId.get(current.in_reply_to_id)
      if (!parent) return current.in_reply_to_id
      current = parent
    }
    return current.id
  }

  const grouped = new Map<number, GitHubReviewComment[]>()
  const order: number[] = []
  for (const comment of comments) {
    const id = rootId(comment)
    const existing = grouped.get(id)
    if (existing) {
      existing.push(comment)
      continue
    }
    grouped.set(id, [comment])
    order.push(id)
  }

  return order.flatMap((id) => {
    const threadComments = grouped.get(id) ?? []
    const root =
      threadComments.find((comment) => comment.in_reply_to_id === undefined) ?? threadComments[0]
    if (!root) return []
    return [
      {
        id,
        path: root.path,
        line: root.line,
        comments: threadComments,
        resolved: root.resolved === true,
      },
    ]
  })
}
