import type {
  PullRequestData,
  PullRequestReviewer,
  ReviewerCandidate,
} from '@jetty/shared/pull-request'

export type PullRequestReference = { repo: string; number: number }

export function referenceKey(ref: PullRequestReference) {
  return `${ref.repo.toLowerCase()}#${ref.number}`
}

export function findPullRequestReferences(body: string, pull: PullRequestReference) {
  let fence = ''
  const prose: string[] = []
  for (const line of body.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (
        marker &&
        marker[1]![0] === fence[0] &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      )
        fence = ''
      prose.push('')
    } else if (marker && !(marker[1]![0] === '`' && marker[2]!.includes('`'))) {
      fence = marker[1]!
      prose.push('')
    } else prose.push(line)
  }
  const text = prose.join('\n').replace(/(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, ' ')
  const references = new Map<string, PullRequestReference>()
  // #123, owner/repo#123, and full GitHub issue or PR links, which the view shows as the same chips.
  const shorthand = text.matchAll(/(?<![\w/#&])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g)
  const links = text.matchAll(
    /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)\b/g
  )
  for (const match of [...shorthand, ...links]) {
    const ref = { repo: match[1] ?? pull.repo, number: Number(match[2]) }
    if (
      !Number.isSafeInteger(ref.number) ||
      ref.number <= 0 ||
      referenceKey(ref) === referenceKey(pull)
    )
      continue
    references.set(referenceKey(ref), ref)
    if (references.size === 30) break
  }
  return [...references.values()]
}

export function pullRequestReferenceFields(refs: readonly PullRequestReference[], index: number) {
  return refs
    .map((ref, referenceIndex) => {
      const [owner, name] = ref.repo.split('/')
      return `r${index}_${referenceIndex}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
      issueOrPullRequest(number:${ref.number}) { __typename
        ... on Issue { number title url state stateReason }
        ... on PullRequest { number title url state isDraft merged }
      }
    }`
    })
    .join('\n')
}

function issueState(issue: Record<string, unknown>): 'open' | 'completed' | 'not_planned' {
  return issue.state === 'OPEN' || issue.stateReason === 'REOPENED'
    ? 'open'
    : issue.stateReason === 'NOT_PLANNED' || issue.stateReason === 'DUPLICATE'
      ? 'not_planned'
      : 'completed'
}

export function mapPullRequestReferences(
  data: unknown,
  refs: readonly PullRequestReference[],
  index: number
) {
  const references: NonNullable<PullRequestData['references']>[number][] = []
  for (const [referenceIndex, ref] of refs.entries()) {
    const item = record(record(record(data)[`r${index}_${referenceIndex}`]).issueOrPullRequest)
    const fields = {
      ...ref,
      number: Number(item.number),
      title: string(item.title),
      url: string(item.url),
    }
    if (item.__typename === 'Issue')
      references.push({ ...fields, kind: 'issue', state: issueState(item) })
    else if (item.__typename === 'PullRequest')
      references.push({
        ...fields,
        kind: 'pull',
        state:
          item.merged === true || item.state === 'MERGED'
            ? 'merged'
            : item.state === 'CLOSED'
              ? 'closed'
              : item.isDraft === true
                ? 'draft'
                : 'open',
      })
  }
  return references
}

export const actorFields = `__typename login avatarUrl url ... on User { name }`
export const pageFields = `totalCount pageInfo { hasNextPage endCursor }`
export const reviewCommentFields = `databaseId state body path line diffHunk createdAt url
  author { ${actorFields} } replyTo { databaseId } pullRequestReview { databaseId }`

export const pullRequestConnections = {
  comments: `nodes { databaseId body createdAt url author { ${actorFields} } }`,
  reviews: `nodes { databaseId state body submittedAt url author { ${actorFields} } }`,
  reviewThreads: `nodes { id isResolved isOutdated path line diffSide startLine
    comments(first:100) { ${pageFields} nodes { ${reviewCommentFields} } } }`,
  commitHistory: `nodes { commit { oid message authoredDate url author { name user { ${actorFields} } }
    parents(first:1) { totalCount } } }`,
  files: `nodes { path viewerViewedState }`,
  timelineItems: `nodes { __typename
    ... on ReadyForReviewEvent { createdAt actor { ${actorFields} } }
    ... on ConvertToDraftEvent { createdAt actor { ${actorFields} } }
    ... on ClosedEvent { createdAt actor { ${actorFields} } }
    ... on ReopenedEvent { createdAt actor { ${actorFields} } }
  }`,
} as const

export function connectionField(field: string, after?: string) {
  const name = field === 'commitHistory' ? 'commitHistory: commits' : field
  const types =
    field === 'timelineItems'
      ? ',itemTypes:[READY_FOR_REVIEW_EVENT,CONVERT_TO_DRAFT_EVENT,CLOSED_EVENT,REOPENED_EVENT]'
      : ''
  return `${name}(first:100${after ? `,after:${JSON.stringify(after)}` : ''}${types}) {
    ${pageFields} ${pullRequestConnections[field as keyof typeof pullRequestConnections]}
  }`
}

export const pullRequestStateFields = `updatedAt headRefOid baseRefOid commits(last:1) { nodes { commit { oid statusCheckRollup { state } } } }`

const checkRollupFields = `commits(last:1) { nodes { commit {
  oid statusCheckRollup { state contexts(first:100) {
    ${pageFields}
    nodes { __typename
      ... on CheckRun { id name status conclusion detailsUrl startedAt completedAt
        isRequired(pullRequestNumber:PR_NUMBER)
        checkSuite { app { name } workflowRun { event workflow { name } } } }
      ... on StatusContext { id context state targetUrl updatedAt description isRequired(pullRequestNumber:PR_NUMBER) }
    }
  } }
} } }`

export const pullRequestChecksFields = `updatedAt headRefOid baseRefOid mergeable mergeStateStatus
  ${checkRollupFields}`

export const pullRequestGraphqlFields = `
  id number title body state isDraft merged mergedAt url createdAt updatedAt
  headRefName headRefOid baseRefName baseRefOid additions deletions changedFiles
  author { ${actorFields} } mergedBy { ${actorFields} } viewerCanUpdate
  headRepository { nameWithOwner } baseRepository { nameWithOwner }
  repository { mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod viewerPermission }
  labels(first:100) { ${pageFields} nodes { name } }
  mergeable mergeStateStatus reviewDecision
  ${Object.keys(pullRequestConnections)
    .map((field) => connectionField(field))
    .join('\n')}
  reviewRequests(first:100) { ${pageFields} nodes {
    asCodeOwner requestedReviewer { __typename
      ... on User { login name avatarUrl url }
      ... on Bot { login avatarUrl url }
      ... on Team { slug name avatarUrl organization { login } }
    }
  } }
  latestReviews(first:100) { ${pageFields} nodes {
    state author { ${actorFields} }
  } }
  latestOpinionatedReviews(first:100) { ${pageFields} nodes {
    state author { ${actorFields} }
  } }
  closingIssuesReferences(first:100) { ${pageFields} nodes {
    number title url state stateReason repository { nameWithOwner }
  } }
  suggestedReviewers { reviewer { login name avatarUrl url } }
  ${checkRollupFields}
`

export function pullRequestGraphqlQuery(
  refs: readonly {
    repo: string
    number: number
    headSha?: string
    references?: readonly PullRequestReference[]
  }[],
  fields = pullRequestGraphqlFields
) {
  return `query { rateLimit { cost remaining resetAt }
    ${fields === pullRequestGraphqlFields ? `viewer { ${actorFields} }` : ''}
    ${refs
      .map((ref, index) => {
        const [owner, name] = ref.repo.split('/')
        const comparison = ref.headSha
          ? `baseRef { compare(headRef:${JSON.stringify(ref.headSha)}) { behindBy headTarget { oid } } }`
          : ''
        return `p${index}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
        pullRequest(number:${ref.number}) { ${fields.replaceAll('PR_NUMBER', String(ref.number))} ${comparison} }
      }
      ${pullRequestReferenceFields(ref.references ?? [], index)}`
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
  const commit = record(record(nodes(pull.commits)[0]).commit)
  const rollup = record(commit.statusCheckRollup)
  const truncatedConnections = [
    'reviewRequests',
    'latestReviews',
    'latestOpinionatedReviews',
    'closingIssuesReferences',
    'reviewThreads',
    'reviews',
    'commitHistory',
    'files',
    'timelineItems',
    'comments',
    'labels',
  ].filter(
    (field) =>
      record(record(pull[field]).pageInfo).hasNextPage === true ||
      (field === 'commitHistory' &&
        Number(record(pull[field]).totalCount) > nodes(pull[field]).length)
  )
  for (const value of nodes(pull.reviewThreads)) {
    const thread = record(value)
    if (record(record(thread.comments).pageInfo).hasNextPage)
      truncatedConnections.push(`reviewThreads.${string(thread.id)}.comments`)
  }
  if (record(record(rollup.contexts).pageInfo).hasNextPage) truncatedConnections.push('checkRuns')
  return {
    pull,
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
        state: issueState(issue),
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
