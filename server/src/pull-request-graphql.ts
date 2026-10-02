import type { PullRequestReviewer, ReviewerCandidate } from '@jetty/shared/pull-request'

export const checkRollupStateFields = `commits(last:1) { nodes { commit { oid statusCheckRollup { state } } } }`

export const checkRollupFields = `commits(last:1) { nodes { commit {
  oid statusCheckRollup { state contexts(first:100) {
    pageInfo { hasNextPage }
    nodes { __typename
      ... on CheckRun { id name status conclusion detailsUrl startedAt completedAt
        checkSuite { app { name } workflowRun { workflow { name } } } }
      ... on StatusContext { id context state targetUrl updatedAt }
    }
  } }
} } }`

export const pullRequestGraphqlFields = `
  updatedAt headRefOid mergeable mergeStateStatus reviewDecision
  latestReviews: reviews(last:100) { pageInfo { hasPreviousPage } nodes {
    databaseId state submittedAt author { __typename login avatarUrl url ... on User { name } }
  } }
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
  checksOnly = false,
  rollupOnly = false
) {
  return `query { rateLimit { cost remaining resetAt }
    ${refs
      .map((ref, index) => {
        const [owner, name] = ref.repo.split('/')
        const comparison =
          !checksOnly && ref.headSha
            ? `baseRef { compare(headRef:${JSON.stringify(ref.headSha)}) { behindBy headTarget { oid } } }`
            : ''
        return `p${index}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
        pullRequest(number:${ref.number}) { ${rollupOnly ? checkRollupStateFields : checksOnly ? checkRollupFields : pullRequestGraphqlFields} ${comparison} }
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

export function nodes(value: unknown): unknown[] {
  return (record(value).nodes as unknown[] | undefined) ?? []
}

export function reviewerLogin(login: string) {
  return login
    .toLowerCase()
    .replace(/^copilot-pull-request-reviewer\[bot\]$/, 'copilot-pull-request-reviewer')
}

export function githubUser(value: unknown) {
  const node = record(value)
  const login = reviewerLogin(string(node.login, 'ghost'))
  const name = login === 'copilot-pull-request-reviewer' ? 'Copilot' : string(node.name)
  return {
    login,
    avatar_url: string(node.avatar_url ?? node.avatarUrl),
    html_url: string(node.html_url ?? node.url),
    ...(name ? { name } : {}),
  }
}

export function mapReviewers(pull: unknown, reviews: readonly unknown[]) {
  const history = [
    ...reviews,
    ...nodes(record(pull).latestReviews).map((value) => {
      const review = record(value)
      return {
        id: review.databaseId,
        state: review.state,
        submitted_at: review.submittedAt,
        user: review.author,
      }
    }),
  ]
  const latest = new Map<string, { review: Record<string, unknown>; at: number }>()
  for (const value of history) {
    const review = record(value)
    if (review.state === 'PENDING') continue
    const login = reviewerLogin(string(record(review.user).login))
    const at = Date.parse(string(review.submitted_at)) || Number(review.id) || 0
    if (login && at >= (latest.get(login)?.at ?? 0)) latest.set(login, { review, at })
  }
  const reviewers = new Map<string, PullRequestReviewer>()
  for (const [login, { review }] of latest) {
    const actor = record(review.user)
    const state = review.state as PullRequestReviewer['latestReviewState']
    reviewers.set(login, {
      ...githubUser(actor),
      kind:
        actor.type === 'Bot' ||
        actor.__typename === 'Bot' ||
        login === 'copilot-pull-request-reviewer'
          ? 'bot'
          : 'user',
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
    const reviewer: PullRequestReviewer = {
      ...identity,
      kind: team
        ? 'team'
        : actor.__typename === 'Bot' || identity.login === 'copilot-pull-request-reviewer'
          ? 'bot'
          : 'user',
      ...(team ? { slug, organization } : {}),
      asCodeOwner: request.asCodeOwner === true,
      requested: true,
      state: 'AWAITING',
      latestReviewState: reviewers.get(identity.login)?.latestReviewState ?? null,
    }
    reviewers.set(identity.login, reviewer)
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
    'closingIssuesReferences',
    'reviewThreads',
  ].filter((field) => record(record(pull[field]).pageInfo).hasNextPage === true)
  for (const field of ['latestReviews', 'comments'])
    if (record(record(pull[field]).pageInfo).hasPreviousPage) truncatedConnections.push(field)
  if (record(record(rollup.contexts).pageInfo).hasNextPage) truncatedConnections.push('checkRuns')
  return {
    pull,
    resolved,
    checks: nodes(rollup.contexts),
    checkRollupState: string(rollup.state),
    truncatedConnections,
    closingIssuesReferences: nodes(pull.closingIssuesReferences).map((value) => {
      const issue = record(value)
      return {
        number: Number(issue.number),
        title: string(issue.title),
        url: string(issue.url),
        repository: { nameWithOwner: string(record(issue.repository).nameWithOwner) },
        state:
          issue.state === 'OPEN' || issue.stateReason === 'REOPENED'
            ? 'open'
            : issue.stateReason === 'NOT_PLANNED' || issue.stateReason === 'DUPLICATE'
              ? 'not_planned'
              : 'completed',
      }
    }),
    issueComments: nodes(pull.comments).map((value) => {
      const comment = record(value)
      const author = record(comment.author)
      return {
        id: Number(comment.databaseId),
        // REST, which the rest of the view reads, names bots with the [bot] suffix GraphQL drops.
        user: githubUser(
          author.__typename === 'Bot'
            ? { ...author, login: `${string(author.login)}[bot]` }
            : author
        ),
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
