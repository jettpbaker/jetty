import type { GitHubIssue, IssueSnapshot } from '@jetty/shared/wire'

import { Effect } from 'effect'

import { nodes, record, string } from './pull-request-graphql'
import { chipRefreshInterval, GhFailure, githubGraphql } from './pull-requests'

export type IssueRef = { repo: string; number: number }

const issueFields = `number title state stateReason updatedAt author { login avatarUrl } labels(first:20) { nodes { name color } } assignees(first:10) { nodes { login avatarUrl } }`

// Chips that ask together share one query, the same way a pull request prefetch drains its queue.
const batchSize = 5
const prefetchLimit = 2

type Waiter = { ref: IssueRef; resolve: (snapshot: IssueSnapshot) => void }

const cache = new Map<string, IssueSnapshot>()
const inflight = new Map<string, Promise<IssueSnapshot>>()
const queue: Waiter[] = []
let active = 0
let hold: ReturnType<typeof setTimeout> | undefined

function issueKey(ref: IssueRef) {
  return `${ref.repo.toLowerCase()}#${ref.number}`
}

function readCache(key: string) {
  const snapshot = cache.get(key)
  if (!snapshot) return
  cache.delete(key)
  cache.set(key, snapshot)
  return snapshot
}

function stillFresh(snapshot: IssueSnapshot) {
  const interval = chipRefreshInterval(snapshot.issue?.state === 'closed')
  if (interval === null) return true
  return snapshot.refreshedAt !== undefined && Date.now() - snapshot.refreshedAt < interval
}

function remember(snapshot: IssueSnapshot) {
  const key = issueKey(snapshot)
  cache.delete(key)
  cache.set(key, snapshot)
  if (cache.size > 256) cache.delete(cache.keys().next().value!)
  return snapshot
}

function settle(waiter: Waiter, snapshot: IssueSnapshot) {
  inflight.delete(issueKey(waiter.ref))
  waiter.resolve(remember(snapshot))
}

function failed(ref: IssueRef, error: unknown): IssueSnapshot {
  return {
    ...ref,
    status: error instanceof GhFailure ? error.kind : 'unavailable',
    refreshedAt: Date.now(),
  }
}

function mapReason(value: unknown, state: GitHubIssue['state']): GitHubIssue['stateReason'] {
  if (value === 'NOT_PLANNED' || value === 'DUPLICATE') return 'not_planned'
  if (value === 'REOPENED') return 'reopened'
  if (value === 'COMPLETED' || state === 'closed') return 'completed'
  return null
}

function mapPeople(value: unknown) {
  const people: { login: string; avatarUrl: string }[] = []
  for (const node of nodes(value)) {
    const person = record(node)
    const login = string(person.login)
    if (login) people.push({ login, avatarUrl: string(person.avatarUrl) })
  }
  return people
}

function mapLabels(value: unknown) {
  const labels: { name: string; color: string }[] = []
  for (const node of nodes(value)) {
    const label = record(node)
    const name = string(label.name)
    if (name) labels.push({ name, color: string(label.color).replace(/^#/, '') })
  }
  return labels
}

function mapIssue(node: Record<string, unknown>): GitHubIssue {
  const state = node.state === 'OPEN' ? 'open' : 'closed'
  const author = record(node.author)
  const login = string(author.login)
  return {
    number: Number(node.number),
    title: string(node.title),
    state,
    stateReason: mapReason(node.stateReason, state),
    updatedAt: string(node.updatedAt),
    author: login ? { login, avatarUrl: string(author.avatarUrl) } : null,
    labels: mapLabels(node.labels),
    assignees: mapPeople(node.assignees),
  }
}

function issueQuery(refs: readonly IssueRef[]) {
  const fields = refs.map((ref, index) => {
    const [owner, name] = ref.repo.split('/')
    return `i${index}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { issue(number:${ref.number}) { ${issueFields} } }`
  })
  return `query { rateLimit { cost remaining resetAt } ${fields.join(' ')} }`
}

async function fetchBatch(batch: readonly Waiter[]) {
  let response: unknown
  try {
    response = await githubGraphql(issueQuery(batch.map((waiter) => waiter.ref)))
  } catch (error) {
    for (const waiter of batch) settle(waiter, failed(waiter.ref, error))
    return
  }
  const data = record(record(response).data)
  for (const [index, waiter] of batch.entries()) {
    const node = record(record(data[`i${index}`]).issue)
    settle(
      waiter,
      node.number
        ? { ...waiter.ref, status: 'ready', refreshedAt: Date.now(), issue: mapIssue(node) }
        : { ...waiter.ref, status: 'not_found', refreshedAt: Date.now() }
    )
  }
}

function pump() {
  while (active < prefetchLimit && queue.length > 0) {
    const batch = queue.splice(0, batchSize)
    active++
    void fetchBatch(batch).finally(() => {
      active--
      pump()
    })
  }
}

// Each chip is its own RPC, so a microtask would flush the first before the next message arrives.
// One frame lets the chips on a message share a query, the way a pull request prefetch batch does.
function drain() {
  if (hold) return
  hold = setTimeout(() => {
    hold = undefined
    pump()
  }, 16)
}

export function prefetchIssue(ref: IssueRef) {
  const key = issueKey(ref)
  const cached = readCache(key)
  if (cached && stillFresh(cached)) return Effect.succeed(cached)
  if (chipRefreshInterval(cached?.issue?.state === 'closed') === null)
    return Effect.succeed(
      cached ?? { repo: ref.repo, number: ref.number, status: 'rate_limited' as const }
    )
  const pending = inflight.get(key)
  if (pending) return Effect.promise(() => pending)
  const normalized = { repo: ref.repo.toLowerCase(), number: ref.number }
  let resolve!: Waiter['resolve']
  const promise = new Promise<IssueSnapshot>((done) => {
    resolve = done
  })
  inflight.set(key, promise)
  queue.push({ ref: normalized, resolve })
  drain()
  return Effect.promise(() => promise)
}
