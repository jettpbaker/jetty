import { Schema } from 'effect'

export const GitHubUser = Schema.Struct({
  login: Schema.String,
  avatar_url: Schema.String,
  html_url: Schema.String,
  name: Schema.optional(Schema.String),
})

export const ReviewerCandidate = GitHubUser
export type ReviewerCandidate = Schema.Schema.Type<typeof ReviewerCandidate>

export const ReviewState = Schema.Literals([
  'APPROVED',
  'CHANGES_REQUESTED',
  'COMMENTED',
  'PENDING',
  'DISMISSED',
])
export const PullRequestReviewer = Schema.Struct({
  ...GitHubUser.fields,
  kind: Schema.Literals(['user', 'bot', 'team']),
  slug: Schema.optional(Schema.String),
  organization: Schema.optional(Schema.String),
  asCodeOwner: Schema.Boolean,
  requested: Schema.Boolean,
  state: Schema.NullOr(Schema.Union([ReviewState, Schema.Literal('AWAITING')])),
  latestReviewState: Schema.NullOr(ReviewState),
})
export type PullRequestReviewer = Schema.Schema.Type<typeof PullRequestReviewer>

export const GitHubRateLimitHealth = Schema.Struct({
  remaining: Schema.NullOr(Schema.Int),
  resetAt: Schema.NullOr(Schema.String),
  cost: Schema.NullOr(Schema.Int),
  restRemaining: Schema.NullOr(Schema.Int),
  restResetAt: Schema.NullOr(Schema.String),
  backoffUntil: Schema.NullOr(Schema.Int),
  cadenceMs: Schema.NullOr(Schema.Int),
  checksCadenceMs: Schema.NullOr(Schema.Int),
})
export const GitHubActivity = Schema.Literals(['focused', 'blurred', 'hidden'])
export type GitHubActivity = Schema.Schema.Type<typeof GitHubActivity>

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
  mergeable_state: Schema.Literals(['clean', 'blocked', 'dirty', 'unstable', 'behind', 'unknown']),
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

export const GitHubIssueComment = Schema.Struct({
  id: Schema.Int,
  user: GitHubUser,
  body: Schema.String,
  created_at: Schema.String,
  html_url: Schema.String,
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
  issueComments: Schema.optional(Schema.Array(GitHubIssueComment)),
  checkRuns: Schema.Array(GitHubCheckRun),
  checkRollupState: Schema.optional(Schema.String),
  checkRunsTotalCount: Schema.optional(Schema.Int),
  commits: Schema.Array(GitHubCommit),
  files: Schema.Array(GitHubFile),
  references: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          repo: Schema.String,
          number: Schema.Int,
          kind: Schema.Literal('issue'),
          state: Schema.Literals(['open', 'completed', 'not_planned']),
          title: Schema.String,
          url: Schema.String,
        }),
        Schema.Struct({
          repo: Schema.String,
          number: Schema.Int,
          kind: Schema.Literal('pull'),
          state: Schema.Literals(['open', 'draft', 'merged', 'closed']),
          title: Schema.String,
          url: Schema.String,
        }),
      ])
    )
  ),
  closingIssuesReferences: Schema.Array(
    Schema.Struct({
      number: Schema.Int,
      title: Schema.String,
      url: Schema.String,
      state: Schema.optional(Schema.Literals(['open', 'completed', 'not_planned'])),
      repository: Schema.optional(Schema.Struct({ nameWithOwner: Schema.String })),
    })
  ),
  suggestedReviewers: Schema.Array(ReviewerCandidate),
  reviewRequests: Schema.optional(Schema.Array(PullRequestReviewer)),
  reviewers: Schema.optional(Schema.Array(PullRequestReviewer)),
  mergeable: Schema.optional(Schema.Literals(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'])),
  mergeStateStatus: Schema.optional(Schema.String),
  behindBy: Schema.optional(Schema.NullOr(Schema.Int)),
  truncatedConnections: Schema.optional(Schema.Array(Schema.String)),
  requestedTeams: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        avatar_url: Schema.String,
        slug: Schema.optional(Schema.String),
        asCodeOwner: Schema.optional(Schema.Boolean),
      })
    )
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
