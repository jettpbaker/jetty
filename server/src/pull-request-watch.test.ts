import type { PullRequestData } from '@jetty/shared/pull-request'

import { afterEach, expect, spyOn, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Orchestrator, PullRequestNews } from './orchestrator'

import { createPullRequestWatch } from './pull-request-watch'
import { StoreError } from './store'
import { openTestStore } from './store-fixture'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

function data(): PullRequestData {
  return {
    pull: {
      number: 1,
      title: 'Fix',
      state: 'open',
      draft: false,
      merged: false,
      merged_at: null,
      html_url: 'https://github.com/owner/repo/pull/1',
      body: '',
      user: { login: 'viewer', avatar_url: '', html_url: '' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      head: { ref: 'feature', sha: 'abc', repo: 'owner/repo' },
      base: { ref: 'main' },
      additions: 0,
      deletions: 0,
      changed_files: 0,
      commits: 1,
      comments: 0,
      review_comments: 0,
      mergeable_state: 'clean',
      requested_reviewers: [],
      labels: [],
    },
    viewer: { login: 'viewer', avatar_url: '', html_url: '' },
    reviews: [],
    reviewComments: [],
    checkRuns: [],
    files: [],
    commits: [],
    closingIssuesReferences: [],
    suggestedReviewers: [],
    mergeCommitAllowed: false,
    squashMergeAllowed: false,
    rebaseMergeAllowed: false,
    viewerDefaultMergeMethod: 'MERGE',
  }
}

function commented(previous: PullRequestData, at = Date.now()): PullRequestData {
  return {
    ...previous,
    issueComments: [
      {
        id: 1,
        user: { login: 'reviewer', avatar_url: '', html_url: '' },
        body: 'Please fix this',
        created_at: new Date(at).toISOString(),
        html_url: 'https://github.com/owner/repo/pull/1#issuecomment-1',
      },
    ],
  }
}

async function setup(orchestrator?: Pick<Orchestrator, 'pullRequestActivity'>) {
  const home = mkdtempSync(join(tmpdir(), 'jetty-pr-watch-'))
  cleanup.push(async () => rmSync(home, { recursive: true, force: true }))
  const fixture = await openTestStore(home)
  cleanup.push(fixture.close)
  const { store, runtime } = fixture
  await runtime.runPromise(store.setAgentBehaviour('watchPullRequests', true))
  const watch = createPullRequestWatch(
    store,
    (orchestrator ?? {
      pullRequestActivity: () => Effect.void,
    }) as Orchestrator
  )
  async function thread(repo: string) {
    const path = mkdtempSync(join(home, 'project-'))
    for (const args of [['init'], ['remote', 'add', 'origin', `https://github.com/${repo}.git`]]) {
      const result = Bun.spawnSync(['git', ...args], { cwd: path })
      expect(result.exitCode).toBe(0)
    }
    const project = await runtime.runPromise(store.createProject(path))
    const thread = await runtime.runPromise(store.createThread(project.id, crypto.randomUUID()))
    await runtime.runPromise(store.setThreadGit(thread.id, { branch: 'feature', dirty: false }))
    await runtime.runPromise(store.linkPullRequest(thread.id, 'owner/repo', 1))
    return thread
  }
  async function change(previous = data(), refreshedAt = Date.now()) {
    const ref = { repo: 'owner/repo', number: 1 }
    await runtime.runPromise(
      store.savePullRequest({
        ...ref,
        status: 'ready',
        data: previous,
        refreshedAt,
        dataRefreshedAt: refreshedAt,
      })
    )
    await runtime.runPromise(
      watch.changed(
        ref,
        { ...ref, status: 'ready', data: previous, refreshedAt, dataRefreshedAt: refreshedAt },
        commented(previous)
      )
    )
    return await runtime.runPromise(store.pullRequestWatch(ref.repo, ref.number))
  }
  return { ...fixture, watch, thread, change }
}

for (const authored of [false, true]) {
  test(`PR ownership verifies the head repository${authored ? ' for authored fallback' : ''}`, async () => {
    const f = await setup()
    await f.thread('other/repo')
    const owner = await f.thread('owner/repo')
    const baseline = data()
    const previous = authored
      ? baseline
      : {
          ...baseline,
          pull: { ...baseline.pull, user: { login: 'someone', avatar_url: '', html_url: '' } },
        }
    if (authored)
      await f.runtime.runPromise(f.store.setThreadGit(owner.id, { branch: 'main', dirty: false }))
    expect((await f.change(previous)).pending?.threadId).toBe(owner.id)
  })
}

test('a missing head repository cannot claim a linked thread', async () => {
  const f = await setup()
  await f.thread('owner/repo')
  const baseline = data()
  const previous = {
    ...baseline,
    pull: { ...baseline.pull, head: { ...baseline.pull.head, repo: null } },
  }
  expect((await f.change(previous)).pending).toBeUndefined()
})

for (const continuous of [false, true]) {
  test(`a fresh review after a quiet day ${continuous ? 'wakes a continuously watched PR' : 'establishes a baseline after sleep'}`, async () => {
    const f = await setup()
    const owner = await f.thread('owner/repo')
    if (continuous) await f.runtime.runPromise(f.watch.observed({ repo: 'owner/repo', number: 1 }))
    const memory = await f.change(data(), Date.now() - 25 * 60 * 60_000)
    expect(memory.pending?.threadId).toBe(continuous ? owner.id : undefined)
    expect(memory.observedAt).toBeGreaterThan(Date.now() - 10_000)
  })
}

test('continuous observations still exclude individual comments older than a day', async () => {
  const f = await setup()
  await f.thread('owner/repo')
  const ref = { repo: 'owner/repo', number: 1 }
  const previous = data()
  const snapshot = {
    ...ref,
    status: 'ready' as const,
    data: previous,
    refreshedAt: Date.now() - 25 * 60 * 60_000,
  }
  await f.runtime.runPromise(f.store.savePullRequest(snapshot))
  await f.runtime.runPromise(f.watch.observed(ref))
  await f.runtime.runPromise(
    f.watch.changed(ref, snapshot, commented(previous, Date.now() - 25 * 60 * 60_000))
  )
  expect(
    (await f.runtime.runPromise(f.store.pullRequestWatch(ref.repo, ref.number))).pending
  ).toBeUndefined()
})

test('failed refresh attempts retain the successful comment watermark through recovery', async () => {
  const f = await setup()
  const owner = await f.thread('owner/repo')
  const ref = { repo: 'owner/repo', number: 1 }
  const previous = data()
  const readAt = Date.now() - 30 * 60_000
  await f.runtime.runPromise(
    f.store.savePullRequest({
      ...ref,
      status: 'ready',
      data: previous,
      refreshedAt: readAt,
      dataRefreshedAt: readAt,
    })
  )
  for (const status of ['unavailable', 'rate_limited', 'not_found'] as const) {
    await f.runtime.runPromise(
      f.store.savePullRequest({ ...ref, status, error: 'Failed', refreshedAt: Date.now() })
    )
    const cached = await f.runtime.runPromise(f.store.getPullRequest(ref.repo, ref.number))
    expect(cached.dataRefreshedAt).toBe(readAt)
    expect(cached.refreshedAt).toBeGreaterThan(readAt)
  }
  const cached = await f.runtime.runPromise(f.store.getPullRequest(ref.repo, ref.number))
  const next = commented(previous, readAt + 60_000)
  await f.runtime.runPromise(f.watch.changed(ref, cached, next))
  expect(
    (await f.runtime.runPromise(f.store.pullRequestWatch(ref.repo, ref.number))).pending?.threadId
  ).toBe(owner.id)
  await f.runtime.runPromise(
    f.store.savePullRequest({
      ...ref,
      status: 'ready',
      data: next,
      refreshedAt: Date.now(),
      dataRefreshedAt: Date.now(),
    })
  )
  expect(
    (await f.runtime.runPromise(f.store.getPullRequest(ref.repo, ref.number))).dataRefreshedAt
  ).toBeGreaterThan(readAt)
})

for (const fallback of [false, true]) {
  test(`an archived PR owner does not suppress its active replacement${fallback ? ' in authored fallback' : ''}`, async () => {
    const f = await setup()
    const archived = await f.thread('owner/repo')
    const active = await f.thread('owner/repo')
    await f.runtime.runPromise(f.store.archiveThread(archived.id, true))
    if (fallback) {
      for (const thread of [archived, active])
        await f.runtime.runPromise(
          f.store.setThreadGit(thread.id, { branch: 'main', dirty: false })
        )
    }
    expect((await f.change()).pending?.threadId).toBe(active.id)
  })
}

test('failed deliveries retry persisted news with bounded backoff', async () => {
  let attempts = 0
  let delivered: PullRequestNews | undefined
  const f = await setup({
    pullRequestActivity: (_threadId, take) =>
      Effect.suspend(() => {
        attempts++
        if (attempts <= 4) return Effect.fail(new StoreError('internal', 'Temporary failure'))
        return f.store.transaction(take).pipe(
          Effect.tap((news) =>
            Effect.sync(() => {
              delivered = news
            })
          ),
          Effect.asVoid
        )
      }),
  })
  await f.thread('owner/repo')
  const nativeSetTimeout = globalThis.setTimeout
  const scheduled = new Map<ReturnType<typeof setTimeout>, { run: () => void; delay: number }>()
  const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number
  ) => {
    const timer = nativeSetTimeout(() => {}, 60 * 60_000)
    timer.unref()
    scheduled.set(timer, { run: callback, delay: Number(delay) })
    return timer
  }) as typeof setTimeout)
  const warningSpy = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await f.change()
    for (const delay of [15_000, 15_000, 30_000, 60_000, 60_000]) {
      expect(scheduled.size).toBe(1)
      const [timer, next] = [...scheduled][0]!
      expect(next.delay).toBe(delay)
      scheduled.delete(timer)
      clearTimeout(timer)
      next.run()
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    expect(attempts).toBe(5)
    expect(delivered?.text).toContain('Please fix this')
    expect((await f.runtime.runPromise(f.store.pendingPullRequestWatches())).length).toBe(0)
    expect(scheduled.size).toBe(0)
  } finally {
    timerSpy.mockRestore()
    warningSpy.mockRestore()
    for (const timer of scheduled.keys()) clearTimeout(timer)
  }
})

test('separate CI failure episodes on the same SHA survive persistent dedupe', async () => {
  const f = await setup()
  await f.thread('owner/repo')
  const ref = { repo: 'owner/repo', number: 1 }
  let previous = { ...data(), checkRollupState: 'SUCCESS' }
  for (const state of ['FAILURE', 'SUCCESS', 'FAILURE', 'SUCCESS']) {
    const next = { ...previous, checkRollupState: state }
    const watch = createPullRequestWatch(f.store, {
      pullRequestActivity: () => Effect.void,
    } as unknown as Orchestrator)
    await f.runtime.runPromise(
      watch.changed(
        ref,
        { ...ref, status: 'ready', data: previous, dataRefreshedAt: Date.now() },
        next
      )
    )
    previous = next
  }
  const memory = await f.runtime.runPromise(f.store.pullRequestWatch(ref.repo, ref.number))
  expect(memory.checkEpisode).toBe(2)
  expect(memory.fired.filter((key) => key.startsWith('failed:'))).toEqual([
    'failed:abc:1',
    'failed:abc:2',
  ])
  expect(memory.fired.filter((key) => key.startsWith('passed:'))).toEqual([
    'passed:abc:1',
    'passed:abc:2',
  ])
  expect(memory.pending?.changes.filter((change) => change.wakes)).toHaveLength(2)
  const same = createPullRequestWatch(f.store, {
    pullRequestActivity: () => Effect.void,
  } as unknown as Orchestrator)
  await f.runtime.runPromise(
    same.changed(
      ref,
      { ...ref, status: 'ready', data: previous, dataRefreshedAt: Date.now() },
      previous
    )
  )
  expect(
    (await f.runtime.runPromise(f.store.pullRequestWatch(ref.repo, ref.number))).checkEpisode
  ).toBe(2)
})
