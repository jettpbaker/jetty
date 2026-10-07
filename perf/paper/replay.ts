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
