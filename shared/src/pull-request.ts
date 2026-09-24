import { Schema } from 'effect'

export const GitHubUser = Schema.Struct({
  login: Schema.String,
  avatar_url: Schema.String,
  html_url: Schema.String,
})

export const ReviewerCandidate = Schema.Struct({
  ...GitHubUser.fields,
  name: Schema.optional(Schema.String),
})
export type ReviewerCandidate = Schema.Schema.Type<typeof ReviewerCandidate>

export const GitHubPullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  state: Schema.Literals(['open', 'closed']),
  draft: Schema.Boolean,
  merged: Schema.Boolean,
  merged_at: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  body: Schema.String,
  user: GitHubUser,
  created_at: Schema.String,
  updated_at: Schema.String,
  head: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  base: Schema.Struct({ ref: Schema.String, sha: Schema.optional(Schema.String) }),
  additions: Schema.Int,
  deletions: Schema.Int,
  changed_files: Schema.Int,
  commits: Schema.Int,
  comments: Schema.Int,
  review_comments: Schema.Int,
  mergeable_state: Schema.Literals(['clean', 'blocked', 'dirty', 'unstable', 'unknown']),
  requested_reviewers: Schema.Array(GitHubUser),
  labels: Schema.Array(Schema.Struct({ name: Schema.String })),
})

export const GitHubReview = Schema.Struct({
  id: Schema.Int,
  user: GitHubUser,
  state: Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED']),
  body: Schema.String,
  submitted_at: Schema.String,
  html_url: Schema.String,
})

export const GitHubReviewComment = Schema.Struct({
  id: Schema.Int,
  user: GitHubUser,
  body: Schema.String,
  path: Schema.String,
  line: Schema.NullOr(Schema.Int),
  created_at: Schema.String,
  html_url: Schema.String,
  in_reply_to_id: Schema.optional(Schema.Int),
  pull_request_review_id: Schema.Int,
  resolved: Schema.optional(Schema.Boolean),
})

export const GitHubCheckRun = Schema.Struct({
  id: Schema.Union([Schema.Int, Schema.String]),
  name: Schema.String,
  status: Schema.Literals(['queued', 'in_progress', 'completed']),
  conclusion: Schema.NullOr(
    Schema.Literals([
      'success',
      'failure',
      'neutral',
      'cancelled',
      'skipped',
      'timed_out',
      'action_required',
      'stale',
      'startup_failure',
    ])
  ),
  started_at: Schema.String,
  completed_at: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  app: Schema.Struct({ name: Schema.String }),
})

export const GitHubCommit = Schema.Struct({
  sha: Schema.String,
  commit: Schema.Struct({
    message: Schema.String,
    author: Schema.Struct({ name: Schema.String, date: Schema.String }),
  }),
  author: Schema.NullOr(GitHubUser),
  html_url: Schema.String,
})

export const GitHubFile = Schema.Struct({
  sha: Schema.String,
  filename: Schema.String,
  status: Schema.Literals(['added', 'removed', 'modified', 'renamed']),
  additions: Schema.Int,
  deletions: Schema.Int,
  changes: Schema.Int,
  previous_filename: Schema.optional(Schema.String),
  patch: Schema.optional(Schema.String),
})

export const PullRequestData = Schema.Struct({
  pull: GitHubPullRequest,
  reviews: Schema.Array(GitHubReview),
  reviewComments: Schema.Array(GitHubReviewComment),
  checkRuns: Schema.Array(GitHubCheckRun),
  commits: Schema.Array(GitHubCommit),
  files: Schema.Array(GitHubFile),
  closingIssuesReferences: Schema.Array(
    Schema.Struct({
      number: Schema.Int,
      title: Schema.String,
      url: Schema.String,
      repository: Schema.optional(Schema.Struct({ nameWithOwner: Schema.String })),
    })
  ),
  suggestedReviewers: Schema.Array(GitHubUser),
  requestedTeams: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, avatar_url: Schema.String }))
  ),
  reviewDecision: Schema.optional(
    Schema.NullOr(Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']))
  ),
  viewerCanRequestReviews: Schema.optional(Schema.Boolean),
  mergeCommitAllowed: Schema.Boolean,
  squashMergeAllowed: Schema.Boolean,
  rebaseMergeAllowed: Schema.Boolean,
  viewerDefaultMergeMethod: Schema.Literals(['MERGE', 'SQUASH', 'REBASE']),
})
export type PullRequestData = Schema.Schema.Type<typeof PullRequestData>
