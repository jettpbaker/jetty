import {
  findPullRequestReferences,
  pullRequestChecksFields,
  pullRequestGraphqlFields,
  pullRequestGraphqlQuery,
  pullRequestStateFields,
  record,
} from '@jetty/server/src/pull-request-graphql'
import { githubUser } from '@jetty/server/src/pull-request-graphql'
import { PullRequestListItem } from '@jetty/shared/wire'
import { Schema } from 'effect'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { perfDir } from '../app'
import { prRepo } from '../seed'

type Recording = { args: string[]; stdin?: string; code: number; stdout: string; stderr: string }

function latestDate(value: unknown): number {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value))
    return Date.parse(value)
  if (!value || typeof value !== 'object') return 0
  return Math.max(0, ...Object.values(value).map(latestDate))
}

function shiftDates(value: Record<string, unknown>, delta: number) {
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(entry))
      value[key] = new Date(Date.parse(entry) + delta).toISOString()
    else if (entry && typeof entry === 'object') shiftDates(entry as Record<string, unknown>, delta)
  }
}

// Query strings evolve; replay the recorded response under the current read-only query keys.
export async function prepareReplay(dir: string) {
  mkdirSync(dir, { recursive: true })
  const pulls = new Map<
    number,
    { fixture: Recording; body: Record<string, unknown>; pull: Record<string, unknown> }
  >()
  for (const name of readdirSync(join(perfDir, 'fixtures/gh'))) {
    if (!name.endsWith('.json')) continue
    const fixture = (await Bun.file(join(perfDir, 'fixtures/gh', name)).json()) as Recording
    try {
      const body = record(JSON.parse(fixture.stdout.split(/\r?\n\r?\n/).at(-1)!))
      const pull = record(record(record(body.data).p0).pullRequest)
      const number = Number(pull.number)
      if (!number || !pull.title) continue
      if (Object.keys(pull).length < Object.keys(pulls.get(number)?.pull ?? {}).length) continue
      pulls.set(number, { fixture, body, pull })
    } catch {}
  }
  for (const [number, { fixture, body, pull }] of pulls) {
    if (number > 4) {
      pulls.delete(number)
      continue
    }
    pull.labels = { totalCount: 1, nodes: [{ name: 'checkout' }] }
    if (number === 1) {
      pull.body =
        '## Checkout discount codes\n\nKeep applied codes when customers change their shipping address. Revalidate eligibility before recalculating totals, and round only once in integer cents.\n\n- Preserve valid codes across address and delivery changes\n- Clear expired codes with an inline explanation\n- Keep free shipping separate from merchandise tax\n\n### Validation\nAll 24 checkout tests pass, including expiry, free shipping and currency changes.'
      pull.reviewDecision = 'APPROVED'
      const reviews = record(pull.reviews).nodes as Record<string, unknown>[]
      const latest = reviews.at(-1)
      if (latest) {
        latest.state = 'APPROVED'
        latest.body =
          'The address-change regression and integer-cent rounding look good. Ready to ship once the checkout checks finish.'
        for (const field of ['latestReviews', 'latestOpinionatedReviews'])
          pull[field] = { totalCount: 1, nodes: [{ state: 'APPROVED', author: latest.author }] }
      }
      for (const thread of record(pull.reviewThreads).nodes as Record<string, unknown>[])
        thread.isResolved = true
      const commit = record((record(pull.commits).nodes as unknown[])[0])
      const rollup = record(record(commit.commit).statusCheckRollup)
      const contexts = record(rollup.contexts)
      const checks = (contexts.nodes as Record<string, unknown>[])
        .filter((check) => check.__typename === 'CheckRun')
        .slice(0, 4)
      for (const [index, check] of checks.entries()) {
        check.name = ['typecheck', 'checkout tests', 'lint', 'build'][index]
        check.status = 'COMPLETED'
        check.conclusion = 'SUCCESS'
        check.isRequired = true
        record(record(check.checkSuite).workflowRun).workflow = { name: 'CI' }
      }
      rollup.state = 'SUCCESS'
      contexts.nodes = checks
      contexts.totalCount = checks.length
    }
    if (number === 2)
      pull.body =
        '## Rename the currency module\n\nMove the shared money helpers to `currency.ts` and format receipt amounts with explicit currency symbols.\n\n### Merge conflict\nThe discount-code branch also changed `src/money.ts`. Keep integer-cent rounding when resolving the rename, then rerun the checkout suite.\n\n- Update imports in cart and receipt code\n- Preserve AUD, USD and EUR formatting\n- Remove the outdated pricing document'
    if (number === 4)
      pull.body =
        'Document local checkout setup, the payment sandbox and the regression test command. Includes a minimal example of applying a discount code to a cart.'
    shiftDates(pull, Date.now() - number * 20 * 60_000 - latestDate(pull))
    const references = findPullRequestReferences(String(pull.body ?? ''), { repo: prRepo, number })
    for (const fields of [
      pullRequestGraphqlFields,
      pullRequestChecksFields,
      pullRequestStateFields,
    ]) {
      for (const headSha of [undefined, String(pull.headRefOid)]) {
        for (const refs of [undefined, references]) {
          const query = pullRequestGraphqlQuery(
            [{ repo: prRepo, number, headSha, references: refs }],
            fields
          )
          await writeRecording(dir, {
            ...fixture,
            args: [
              'api',
              '--hostname',
              'github.com',
              '--include',
              'graphql',
              '-f',
              `query=${query}`,
            ],
            stdout: `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`,
          })
        }
      }
    }
  }
  const snapshots = [...pulls.values()].toSorted(
    (a, b) => Number(a.pull.number) - Number(b.pull.number)
  )
  for (let mask = 1; mask < 1 << snapshots.length; mask++) {
    const group = snapshots.filter((_, index) => mask & (1 << index))
    if (group.length < 2) continue
    const data = { ...record(group[0]!.body.data) }
    for (const [index, { pull }] of group.entries()) data[`p${index}`] = { pullRequest: pull }
    for (const fields of [
      pullRequestGraphqlFields,
      pullRequestChecksFields,
      pullRequestStateFields,
    ]) {
      const query = pullRequestGraphqlQuery(
        group.map(({ pull }) => ({ repo: prRepo, number: Number(pull.number) })),
        fields
      )
      await writeRecording(dir, {
        ...group[0]!.fixture,
        args: ['api', '--hostname', 'github.com', '--include', 'graphql', '-f', `query=${query}`],
        stdout: `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ data })}`,
      })
    }
  }
  return [...pulls.values()].map(({ pull }) =>
    Schema.decodeUnknownSync(PullRequestListItem)({
      repo: prRepo,
      number: Number(pull.number),
      title: pull.title,
      url: pull.url,
      state: pull.merged
        ? 'merged'
        : pull.isDraft
          ? 'draft'
          : pull.state === 'OPEN'
            ? 'open'
            : 'closed',
      author: githubUser(pull.author),
      additions: pull.additions,
      deletions: pull.deletions,
      reviewDecision: pull.reviewDecision,
      mergeable: pull.mergeable,
      mergeStateStatus: pull.mergeStateStatus,
      updatedAt: Date.parse(String(pull.updatedAt)),
    })
  )
}

async function writeRecording(dir: string, fixture: Recording) {
  const args = fixture.args.map((arg) => arg.replace(/\s+/g, ' ').trim())
  const hash = new Bun.CryptoHasher('sha256')
    .update(JSON.stringify({ args, stdin: fixture.stdin ?? '' }))
    .digest('hex')
    .slice(0, 16)
  await Bun.write(join(dir, `paper-replay-${hash}.json`), JSON.stringify({ ...fixture, args }))
}
