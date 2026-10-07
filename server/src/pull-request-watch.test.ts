import type { PullRequestData } from '@jetty/shared/pull-request'

import { afterEach, expect, spyOn, test } from 'bun:test'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Orchestrator, PullRequestNews } from './orchestrator'

import { createPullRequestWatch } from './pull-request-watch'
import { StoreError, type Store } from './store'
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
  const sql = await runtime.runPromise(SqlClient.SqlClient)
  const watch = createPullRequestWatch(
    store,
    (orchestrator ?? {
      pullRequestActivity: () => Effect.void,
    }) as Orchestrator
  )
  // Linking transfers, so a second live link has to be inserted. Later stamps keep ORDER BY linked_at stable.
  let linkedAt = Date.now()
  async function thread(repo: string, link: 'transfer' | 'keep' = 'transfer') {
    const path = mkdtempSync(join(home, 'project-'))
    for (const args of [['init'], ['remote', 'add', 'origin', `https://github.com/${repo}.git`]]) {
      const result = Bun.spawnSync(['git', ...args], { cwd: path })
      expect(result.exitCode).toBe(0)
    }
    const project = await runtime.runPromise(store.createProject(path))
    const thread = await runtime.runPromise(store.createThread(project.id, crypto.randomUUID()))
    await runtime.runPromise(store.setThreadGit(thread.id, { branch: 'feature', dirty: false }))
    if (link === 'keep') {
      linkedAt += 60_000
      await runtime.runPromise(
        sql`INSERT OR IGNORE INTO pull_requests (repo, number) VALUES ('owner/repo', 1)`
      )
      await runtime.runPromise(
        sql`INSERT OR IGNORE INTO thread_pull_requests (thread_id, repo, number, linked_at)
          VALUES (${thread.id}, 'owner/repo', 1, ${linkedAt})`
      )
    } else {
      await runtime.runPromise(store.linkPullRequest(thread.id, 'owner/repo', 1))
    }
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
  test(`a pull request linked to several threads still wakes the in-repo thread ${authored ? 'when the viewer opened it' : 'on its branch'}`, async () => {
    const f = await setup()
    const other = await f.thread('other/repo')
    const owner = await f.thread('owner/repo', 'keep')
    expect(await f.runtime.runPromise(f.store.threadsForPullRequest('owner/repo', 1))).toEqual([
      other.id,
      owner.id,
    ])
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

test('the one linked thread owns the pull request when its head repository is missing', async () => {
  const f = await setup()
  const owner = await f.thread('owner/repo')
  const baseline = data()
  const previous = {
    ...baseline,
    pull: { ...baseline.pull, head: { ...baseline.pull.head, repo: null } },
  }
  expect((await f.change(previous)).pending?.threadId).toBe(owner.id)
})

test('a pull request linked to several threads wakes nobody when its head repository is missing', async () => {
  const f = await setup()
  const first = await f.thread('owner/repo')
  const second = await f.thread('other/repo', 'keep')
  expect(await f.runtime.runPromise(f.store.threadsForPullRequest('owner/repo', 1))).toEqual([
    first.id,
    second.id,
  ])
  const baseline = data()
  const previous = {
    ...baseline,
    pull: { ...baseline.pull, head: { ...baseline.pull.head, repo: null } },
  }
  expect((await f.change(previous)).pending).toBeUndefined()
})

test('the one linked thread owns the pull request even when its branch and repo do not match', async () => {
  const f = await setup()
  const owner = await f.thread('other/repo')
  await f.runtime.runPromise(f.store.setThreadGit(owner.id, { branch: 'main', dirty: false }))
  const baseline = data()
  const previous = {
    ...baseline,
    pull: { ...baseline.pull, user: { login: 'someone', avatar_url: '', html_url: '' } },
  }
  expect((await f.change(previous)).pending?.threadId).toBe(owner.id)
})

test('a pull request linked to several threads still goes to the thread on its branch', async () => {
  const f = await setup()
  const earlier = await f.thread('owner/repo')
  await f.runtime.runPromise(f.store.setThreadGit(earlier.id, { branch: 'main', dirty: false }))
  const feature = await f.thread('owner/repo', 'keep')
  const later = await f.thread('owner/repo', 'keep')
  await f.runtime.runPromise(f.store.setThreadGit(later.id, { branch: 'main', dirty: false }))
  expect(await f.runtime.runPromise(f.store.threadsForPullRequest('owner/repo', 1))).toEqual([
    earlier.id,
    feature.id,
    later.id,
  ])
  const baseline = data()
  const previous = {
    ...baseline,
    pull: { ...baseline.pull, user: { login: 'someone', avatar_url: '', html_url: '' } },
  }
  expect((await f.change(previous)).pending?.threadId).toBe(feature.id)
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
    const active = await f.thread('owner/repo', 'keep')
    expect(await f.runtime.runPromise(f.store.threadsForPullRequest('owner/repo', 1))).toEqual([
      archived.id,
      active.id,
    ])
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
  // Only the watcher's backoff delays are captured; other timers in the process run as usual.
  const backoff = new Set([15_000, 30_000, 60_000])
  const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number
  ) => {
    if (!backoff.has(Number(delay))) return nativeSetTimeout(callback, delay)
    const timer = nativeSetTimeout(() => {}, 60 * 60_000)
    timer.unref()
    scheduled.set(timer, { run: callback, delay: Number(delay) })
    return timer
  }) as typeof setTimeout)
  const warningSpy = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await f.change()
    // Each attempt settles over a few macrotasks; wait for its outcome rather than assume one.
    async function settled(attempt: number) {
      for (let tick = 0; tick < 200 && attempts < attempt; tick++)
        await new Promise<void>((resolve) => setImmediate(resolve))
      for (let tick = 0; tick < 200 && attempt <= 4 && scheduled.size === 0; tick++)
        await new Promise<void>((resolve) => setImmediate(resolve))
    }
    for (const [index, delay] of [15_000, 15_000, 30_000, 60_000, 60_000].entries()) {
      expect(scheduled.size).toBe(1)
      const [timer, next] = [...scheduled][0]!
      expect(next.delay).toBe(delay)
      scheduled.delete(timer)
      clearTimeout(timer)
      next.run()
      await settled(index + 1)
    }
    for (let tick = 0; tick < 200 && !delivered; tick++)
      await new Promise<void>((resolve) => setImmediate(resolve))
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

test('a passing re-run is not reported as checks failed', async () => {
  const f = await setup()
  await f.thread('owner/repo')
  const ref = { repo: 'owner/repo', number: 1 }
  const previous = { ...data(), checkRollupState: 'SUCCESS' }
  const next = {
    ...previous,
    // GitHub's rollup can stay FAILURE while the latest attempt of the check has passed.
    checkRollupState: 'FAILURE',
    checkRuns: [
      {
        id: '2',
        name: 'build',
        status: 'completed' as const,
        conclusion: 'success' as const,
        started_at: '2026-01-01T01:00:00Z',
        completed_at: '2026-01-01T01:05:00Z',
        html_url: 'https://github.com/owner/repo/runs/2',
        app: { name: 'GitHub Actions' },
      },
    ],
  }
  await f.runtime.runPromise(
    f.watch.changed(
      ref,
      { ...ref, status: 'ready', data: previous, dataRefreshedAt: Date.now() },
      next
    )
  )
  const memory = await f.runtime.runPromise(f.store.pullRequestWatch(ref.repo, ref.number))
  expect(memory.checkEpisode ?? 0).toBe(0)
  expect(memory.fired.filter((key) => key.startsWith('failed:'))).toEqual([])
  expect(memory.pending).toBeUndefined()
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

// Becoming ready posts a line either way. It wakes the agent to merge only while that is on,
// once per head, and a full hour of wakes holds it like any other news.
for (const mode of ['off', 'on', 'held'] as const) {
  test(`a pull request ready to merge ${mode === 'off' ? 'stays a line' : mode === 'held' ? 'is held at the wake cap' : 'wakes its agent to merge'}`, async () => {
    let store!: Store
    let news: PullRequestNews | undefined
    const f = await setup({
      pullRequestActivity: (_threadId, take) =>
        store.transaction(take).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              news = value
            })
          ),
          Effect.asVoid
        ),
    })
    store = f.store
    await f.thread('owner/repo')
    if (mode !== 'off')
      await f.runtime.runPromise(f.store.setAgentBehaviour('mergeWhenReady', true))
    const ref = { repo: 'owner/repo', number: 1 }
    const previous = data()
    const next = { ...previous, mergeStateStatus: 'CLEAN' }
    const refreshedAt = Date.now()
    const nativeSetTimeout = globalThis.setTimeout
    const queued: Array<{ run: () => void; timer: ReturnType<typeof setTimeout> }> = []
    const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: () => void,
      delay?: number
    ) => {
      if (delay !== 15_000) return nativeSetTimeout(callback, delay)
      const timer = nativeSetTimeout(() => {}, 60 * 60_000)
      timer.unref()
      queued.push({ run: callback, timer })
      return timer
    }) as typeof setTimeout)
    try {
      const snapshot = {
        ...ref,
        status: 'ready' as const,
        data: previous,
        refreshedAt,
        dataRefreshedAt: refreshedAt,
      }
      await f.runtime.runPromise(f.store.savePullRequest(snapshot))
      await f.runtime.runPromise(f.watch.changed(ref, snapshot, next))
      expect(queued).toHaveLength(1)
      if (mode === 'held') {
        const memory = await f.runtime.runPromise(f.store.pullRequestWatch(ref.repo, ref.number))
        await f.runtime.runPromise(
          f.store.savePullRequestWatch(ref.repo, ref.number, {
            ...memory,
            wakes: Array.from({ length: 6 }, () => Date.now()),
          })
        )
      }
      queued[0]!.run()
      for (let tick = 0; tick < 200 && !news; tick++)
        await new Promise<void>((resolve) => setImmediate(resolve))
      const delivered = news!
      expect(delivered.lines.map((line) => line.activity.map((entry) => entry.type))).toEqual([
        ['ready'],
      ])
      if (mode === 'on') {
        expect(delivered.lines[0]?.held).toBeUndefined()
        expect(delivered.text).toContain('gh pr merge')
        expect(delivered.text).toContain('deleteBranchOnMerge')
        expect(delivered.text).toContain("don't merge")
        const blocked = { ...next, mergeStateStatus: 'BLOCKED' }
        await f.runtime.runPromise(f.watch.changed(ref, { ...snapshot, data: blocked }, next))
        expect(queued).toHaveLength(1)
        expect(
          (await f.runtime.runPromise(f.store.pullRequestWatch(ref.repo, ref.number))).pending
        ).toBeUndefined()
      } else {
        expect(delivered.text).toBeNull()
        expect(delivered.lines[0]?.held).toBe(mode === 'held' ? true : undefined)
      }
    } finally {
      timerSpy.mockRestore()
      for (const { timer } of queued) clearTimeout(timer)
    }
  })
}
