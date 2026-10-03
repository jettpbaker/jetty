import type { PullRequestReviewer, ReviewerCandidate } from '@jetty/shared/pull-request'

export const pullRequestStateFields = `updatedAt commits(last:1) { nodes { commit { oid statusCheckRollup { state } } } }`

export const checkRollupFields = `commits(last:1) { nodes { commit {
  oid statusCheckRollup { state contexts(first:100) {
    totalCount pageInfo { hasNextPage }
    nodes { __typename
      ... on CheckRun { id name status conclusion detailsUrl startedAt completedAt
        checkSuite { app { name } workflowRun { workflow { name } } } }
      ... on StatusContext { id context state targetUrl updatedAt }
    }
  } }
} } }`

export const pullRequestGraphqlFields = `
  updatedAt headRefOid mergeable mergeStateStatus reviewDecision
  comments(last:100) { pageInfo { hasPreviousPage } nodes {
    databaseId body createdAt url author { __typename login avatarUrl url }
  } }
  reviewRequests(first:100) { pageInfo { hasNextPage } nodes {
    asCodeOwner requestedReviewer { __typename
      ... on User { login name avatarUrl url }
      ... on Bot { login avatarUrl url }
      ... on Team { slug name avatarUrl organization { login } }
    }
  } }
  latestReviews(first:100) { pageInfo { hasNextPage } nodes {
    state author { __typename login avatarUrl url }
  } }
  latestOpinionatedReviews(first:100) { pageInfo { hasNextPage } nodes {
    state author { __typename login avatarUrl url }
  } }
  closingIssuesReferences(first:100) { pageInfo { hasNextPage } nodes {
    number title url state stateReason repository { nameWithOwner }
  } }
  suggestedReviewers { reviewer { login name avatarUrl url } }
  reviewThreads(first:100) { pageInfo { hasNextPage } nodes {
    isResolved comments(first:1) { nodes { databaseId } }
  } }
  ${checkRollupFields}
`

export function pullRequestGraphqlQuery(
  refs: readonly { repo: string; number: number; headSha?: string }[],
  fields = pullRequestGraphqlFields
) {
  return `query { rateLimit { cost remaining resetAt }
    ${refs
      .map((ref, index) => {
        const [owner, name] = ref.repo.split('/')
        const comparison = ref.headSha
          ? `baseRef { compare(headRef:${JSON.stringify(ref.headSha)}) { behindBy headTarget { oid } } }`
          : ''
        return `p${index}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
        pullRequest(number:${ref.number}) { ${fields} ${comparison} }
      }`
      })
      .join('\n')}
  }`
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

// GitHub's connection nodes are nullable: a node it couldn't resolve comes back as null.
export function nodes(value: unknown): unknown[] {
  return ((record(value).nodes as unknown[] | undefined) ?? []).filter((node) => node != null)
}

// GitHub names the review bot `Copilot` on comments and `copilot-pull-request-reviewer[bot]` on
// reviews and review requests; the snapshot shows it as `Copilot` and writes use the bot login.
export const copilotWriteLogin = 'copilot-pull-request-reviewer[bot]'

export function canonicalLogin(login: string) {
  const lower = login.toLowerCase()
  return lower === 'copilot' || lower === copilotWriteLogin ? 'Copilot' : login
}

export function githubUser(value: unknown) {
  const node = record(value)
  // REST names bots with a `[bot]` suffix that GraphQL drops.
  const login = canonicalLogin(
    `${string(node.login, 'ghost')}${node.__typename === 'Bot' ? '[bot]' : ''}`
  )
  const name = string(node.name)
  return {
    login,
    avatar_url: string(node.avatar_url ?? node.avatarUrl),
    html_url: string(node.html_url ?? node.url),
    ...(name ? { name } : {}),
  }
}

function reviewerKind(login: string): PullRequestReviewer['kind'] {
  return login === 'Copilot' || login.endsWith('[bot]') ? 'bot' : 'user'
}

export function mapReviewers(pull: unknown) {
  const reviews = [
    ...nodes(record(pull).latestReviews),
    ...nodes(record(pull).latestOpinionatedReviews),
  ]
  const reviewers = new Map<string, PullRequestReviewer>()
  for (const value of reviews) {
    const review = record(value)
    if (review.state === 'PENDING') continue
    const actor = githubUser(review.author)
    const state = review.state as PullRequestReviewer['latestReviewState']
    reviewers.set(actor.login.toLowerCase(), {
      ...actor,
      kind: reviewerKind(actor.login),
      requested: false,
      asCodeOwner: false,
      state,
      latestReviewState: state,
    })
  }
  const reviewRequests: PullRequestReviewer[] = []
  for (const value of nodes(record(pull).reviewRequests)) {
    const request = record(value)
    const actor = record(request.requestedReviewer)
    if (!actor.login && !actor.slug) continue
    const team = actor.__typename === 'Team'
    const organization = string(record(actor.organization).login)
    const slug = string(actor.slug)
    const identity = team
      ? {
          login: `${organization}/${slug}`,
          name: string(actor.name),
          avatar_url: string(actor.avatarUrl),
          html_url: `https://github.com/orgs/${organization}/teams/${slug}`,
        }
      : githubUser(actor)
    const key = identity.login.toLowerCase()
    const reviewer: PullRequestReviewer = {
      ...identity,
      kind: team ? 'team' : reviewerKind(identity.login),
      ...(team ? { slug, organization } : {}),
      asCodeOwner: request.asCodeOwner === true,
      requested: true,
      state: 'AWAITING',
      latestReviewState: reviewers.get(key)?.latestReviewState ?? null,
    }
    reviewers.set(key, reviewer)
    reviewRequests.push(reviewer)
  }
  return { reviewRequests, reviewers: [...reviewers.values()] }
}

export function mapPullRequestGraphql(value: unknown) {
  const pull = record(value)
  const resolved = new Map<number, boolean>()
  for (const value of nodes(pull.reviewThreads)) {
    const thread = record(value)
    for (const comment of nodes(thread.comments))
      resolved.set(Number(record(comment).databaseId), thread.isResolved === true)
  }
  const commit = record(record(nodes(pull.commits)[0]).commit)
  const rollup = record(commit.statusCheckRollup)
  const truncatedConnections = [
    'reviewRequests',
    'latestReviews',
    'latestOpinionatedReviews',
    'closingIssuesReferences',
    'reviewThreads',
  ].filter((field) => record(record(pull[field]).pageInfo).hasNextPage === true)
  if (record(record(pull.comments).pageInfo).hasPreviousPage) truncatedConnections.push('comments')
  if (record(record(rollup.contexts).pageInfo).hasNextPage) truncatedConnections.push('checkRuns')
  return {
    pull,
    resolved,
    headSha: string(commit.oid),
    checks: nodes(rollup.contexts),
    checkRollupState: string(rollup.state),
    checkRunsTotalCount:
      typeof record(rollup.contexts).totalCount === 'number'
        ? (record(rollup.contexts).totalCount as number)
        : undefined,
    truncatedConnections,
    closingIssuesReferences: nodes(pull.closingIssuesReferences).map((value) => {
      const issue = record(value)
      return {
        number: Number(issue.number),
        title: string(issue.title),
        url: string(issue.url),
        repository: { nameWithOwner: string(record(issue.repository).nameWithOwner) },
        state:
          issue.state === 'OPEN'
            ? 'open'
            : issue.stateReason === 'NOT_PLANNED' || issue.stateReason === 'DUPLICATE'
              ? 'not_planned'
              : 'completed',
      }
    }),
    issueComments: nodes(pull.comments).map((value) => {
      const comment = record(value)
      return {
        id: Number(comment.databaseId),
        user: githubUser(comment.author),
        body: string(comment.body),
        created_at: string(comment.createdAt),
        html_url: string(comment.url),
      }
    }),
    suggestedReviewers: ((pull.suggestedReviewers as unknown[]) ?? []).map(
      (value): ReviewerCandidate => githubUser(record(value).reviewer)
    ),
    reviewDecision: pull.reviewDecision,
  }
}
