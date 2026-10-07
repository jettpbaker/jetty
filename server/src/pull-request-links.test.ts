import type { PullRequestData } from '@jetty/shared/pull-request'
import type { ThreadMeta } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { afterEach, expect, test } from 'bun:test'
import { Deferred, Effect, Queue } from 'effect'
import { SqlClient } from 'effect/sql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Agent, Emit } from './agent'
import type { PullRequestLinks } from './pull-requests'

import { createHub } from './hub'
import { createOrchestrator } from './orchestrator'
import { createPullRequestLinks, createPullRequests } from './pull-requests'
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

function pull(
  number: number,
  head: string,
  patch: {
    state?: 'open' | 'closed'
    merged?: boolean
    draft?: boolean
    headRepo?: string | null
    repo?: string
  } = {}
): { repo: string; data: PullRequestData } {
  const repo = patch.repo ?? 'owner/repo'
  const row = data()
  return {
    repo,
    data: {
      ...row,
      pull: {
        ...row.pull,
        number,
        state: patch.state ?? 'open',
        draft: patch.draft ?? false,
        merged: patch.merged ?? false,
        html_url: `https://github.com/${repo}/pull/${number}`,
        head: { ref: head, sha: 'abc', repo: 'headRepo' in patch ? patch.headRepo : repo },
      },
    },
  }
}

function gitRepo(parent: string) {
  const path = mkdtempSync(join(parent, 'project-'))
  for (const args of [['init'], ['remote', 'add', 'origin', 'https://github.com/owner/repo.git']]) {
    const result = Bun.spawnSync(['git', ...args], { cwd: path })
    expect(result.exitCode).toBe(0)
  }
  return path
}

function refsOf(thread: ThreadMeta | undefined) {
  return (thread?.pullRequests ?? []).map((link) => `${link.repo}#${link.number}`).sort()
}

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'jetty-pr-links-'))
  cleanup.push(async () => rmSync(home, { recursive: true, force: true }))
  const fixture = await openTestStore(home)
  cleanup.push(fixture.close)
  const { store, runtime } = fixture
  const project = await runtime.runPromise(store.createProject(gitRepo(home)))
  const hub = createHub()
  const chrome: ThreadMeta[] = []
  const pushChrome = hub.pushChrome
  hub.pushChrome = (update) => {
    if (update.type === 'thread.upserted') chrome.push(update.thread)
    pushChrome(update)
  }
  const sql = await runtime.runPromise(SqlClient.SqlClient)
  function run(body: (links: PullRequestLinks) => Effect.Effect<void, unknown>) {
    return runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope
          const links = createPullRequestLinks(store, hub, createPullRequests(store, hub), scope)
          yield* body(links)
          yield* Effect.yieldNow
        })
      )
    )
  }
  return { ...fixture, project, hub, chrome, sql, run }
}

const url = (number: number, repo = 'owner/repo') => `https://github.com/${repo}/pull/${number}`

test('linking a pull request moves it off the thread that had it', async () => {
  const f = await setup()
  const owner = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const next = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  await f.run((links) =>
    Effect.gen(function* () {
      const row = pull(1, 'feature')
      yield* f.store.savePullRequest({
        repo: row.repo,
        number: 1,
        status: 'ready',
        data: row.data,
        refreshedAt: Date.now(),
        dataRefreshedAt: Date.now(),
      })
      yield* f.store.linkPullRequest(owner.id, row.repo, 1)
      f.chrome.length = 0
      const linked = yield* links.link(next.id, url(1))
      expect(linked.thread.pullRequests.map((link) => link.number)).toEqual([1])
      expect(f.chrome.map((thread) => thread.id)).toEqual([next.id, owner.id])
      expect(refsOf(f.chrome[0])).toEqual(['owner/repo#1'])
      expect(refsOf(f.chrome[1])).toEqual([])
      f.chrome.length = 0
      yield* links.link(next.id, url(1))
      expect(f.chrome).toEqual([])
      expect(yield* f.store.threadsForPullRequest(row.repo, 1)).toEqual([next.id])
    })
  )
})

test('linking resolves a pull request that was already on two threads', async () => {
  const f = await setup()
  const owner = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const next = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  await f.run((links) =>
    Effect.gen(function* () {
      const row = pull(4, 'feature')
      yield* f.store.savePullRequest({
        repo: row.repo,
        number: 4,
        status: 'ready',
        data: row.data,
        refreshedAt: Date.now(),
        dataRefreshedAt: Date.now(),
      })
      yield* f.store.linkPullRequest(owner.id, row.repo, 4)
      yield* f.sql`INSERT OR IGNORE INTO thread_pull_requests (thread_id, repo, number, linked_at)
        VALUES (${next.id}, ${row.repo}, 4, ${Date.now() + 60_000})`
      f.chrome.length = 0
      yield* links.link(next.id, url(4))
      expect(f.chrome.map((thread) => thread.id)).toEqual([owner.id])
      expect(refsOf(f.chrome[0])).toEqual([])
      expect(yield* f.store.threadsForPullRequest(row.repo, 4)).toEqual([next.id])
    })
  )
})

test('looking at a pull request links it only when no thread has it', async () => {
  const f = await setup()
  const owner = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const reader = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  await f.run((links) =>
    Effect.gen(function* () {
      for (const number of [1, 2]) {
        const row = pull(number, 'feature')
        yield* f.store.savePullRequest({
          repo: row.repo,
          number,
          status: 'ready',
          data: row.data,
          refreshedAt: Date.now(),
          dataRefreshedAt: Date.now(),
        })
      }
      yield* f.store.linkPullRequest(owner.id, 'owner/repo', 1)
      f.chrome.length = 0
      const claimed = yield* f.store.linkPullRequest(reader.id, 'owner/repo', 1, 'claim')
      expect(claimed.linked).toBe(false)
      expect(claimed.changed).toEqual([])
      yield* links.linkFound(reader.id, url(1), 'claim')
      expect(f.chrome).toEqual([])
      expect(yield* f.store.threadsForPullRequest('owner/repo', 1)).toEqual([owner.id])
      yield* links.linkFound(reader.id, url(2), 'claim')
      expect(f.chrome.map((thread) => thread.id)).toEqual([reader.id])
      expect(refsOf(f.chrome[0])).toEqual(['owner/repo#2'])
      f.chrome.length = 0
      const again = yield* f.store.linkPullRequest(reader.id, 'owner/repo', 2, 'claim')
      expect(again.linked).toBe(true)
      expect(again.changed).toEqual([])
      yield* links.linkFound(reader.id, url(2), 'claim')
      expect(f.chrome).toEqual([])
      expect(yield* f.store.threadsForPullRequest('owner/repo', 2)).toEqual([reader.id])
    })
  )
})

test('opening a pull request takes it from the thread that had it', async () => {
  const f = await setup()
  const owner = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const opener = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  await f.run((links) =>
    Effect.gen(function* () {
      const row = pull(7, 'feature')
      yield* f.store.savePullRequest({
        repo: row.repo,
        number: 7,
        status: 'ready',
        data: row.data,
        refreshedAt: Date.now(),
        dataRefreshedAt: Date.now(),
      })
      yield* f.store.linkPullRequest(owner.id, row.repo, 7)
      f.chrome.length = 0
      yield* links.linkFound(opener.id, `Opened ${url(7)}`, 'transfer')
      expect(f.chrome.map((thread) => thread.id)).toEqual([opener.id, owner.id])
      expect(refsOf(f.chrome[0])).toEqual(['owner/repo#7'])
      expect(refsOf(f.chrome[1])).toEqual([])
    })
  )
})

test('a push takes open pull requests on the branch another thread owns', async () => {
  const f = await setup()
  const owner = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const pusher = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  await f.run((links) =>
    Effect.gen(function* () {
      const rows = [
        { number: 1, ...pull(1, 'feature', { headRepo: 'Owner/Repo' }) },
        { number: 2, ...pull(2, 'other') },
        { number: 3, ...pull(3, 'feature', { state: 'closed' }) },
        { number: 4, ...pull(4, 'feature', { headRepo: 'fork/repo' }) },
        { number: 5, ...pull(5, 'feature') },
        { number: 6, ...pull(6, 'feature', { repo: 'other/repo' }) },
        { number: 7, ...pull(7, 'feature', { headRepo: null }) },
        { number: 8, ...pull(8, 'feature', { draft: true }) },
        { number: 9, ...pull(9, 'feature', { merged: true }) },
        { number: 10, ...pull(10, 'feature') },
      ]
      for (const row of rows)
        yield* f.store.savePullRequest({
          repo: row.repo,
          number: row.number,
          status: 'ready',
          data: row.data,
          refreshedAt: Date.now(),
          dataRefreshedAt: Date.now(),
        })
      for (const number of [1, 2, 3, 4, 7, 8, 9])
        yield* f.store.linkPullRequest(owner.id, 'owner/repo', number)
      yield* f.store.linkPullRequest(owner.id, 'other/repo', 6)
      yield* f.store.linkPullRequest(pusher.id, 'owner/repo', 10)
      yield* f.store.setThreadGit(pusher.id, { branch: 'feature', dirty: false })
      f.chrome.length = 0
      yield* links.linkPushed(pusher.id)
      expect(f.chrome.map((thread) => thread.id)).toEqual([
        pusher.id,
        owner.id,
        pusher.id,
        owner.id,
        pusher.id,
        owner.id,
      ])
      expect(refsOf(f.chrome.findLast((thread) => thread.id === pusher.id))).toEqual([
        'owner/repo#1',
        'owner/repo#10',
        'owner/repo#7',
        'owner/repo#8',
      ])
      expect(refsOf(f.chrome.findLast((thread) => thread.id === owner.id))).toEqual([
        'other/repo#6',
        'owner/repo#2',
        'owner/repo#3',
        'owner/repo#4',
        'owner/repo#9',
      ])
      expect(yield* f.store.threadsForPullRequest('owner/repo', 5)).toEqual([])
      yield* links.linkPushed(pusher.id)
      expect(f.chrome).toHaveLength(6)
    })
  )
})

test('a push from a thread with no branch changes nothing', async () => {
  const f = await setup()
  const owner = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const pusher = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  await f.run((links) =>
    Effect.gen(function* () {
      const row = pull(1, 'feature')
      yield* f.store.savePullRequest({
        repo: row.repo,
        number: 1,
        status: 'ready',
        data: row.data,
        refreshedAt: Date.now(),
        dataRefreshedAt: Date.now(),
      })
      yield* f.store.linkPullRequest(owner.id, row.repo, 1)
      yield* links.linkPushed(pusher.id)
      expect(yield* f.store.threadsForPullRequest(row.repo, 1)).toEqual([owner.id])
      expect(f.chrome).toEqual([])
    })
  )
})

test('a push takes a pull request this thread still shares with another', async () => {
  const f = await setup()
  const owner = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const pusher = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  await f.run((links) =>
    Effect.gen(function* () {
      const row = pull(1, 'feature')
      yield* f.store.savePullRequest({
        repo: row.repo,
        number: 1,
        status: 'ready',
        data: row.data,
        refreshedAt: Date.now(),
        dataRefreshedAt: Date.now(),
      })
      yield* f.store.linkPullRequest(owner.id, row.repo, 1)
      yield* f.sql`INSERT OR IGNORE INTO thread_pull_requests (thread_id, repo, number, linked_at)
        VALUES (${pusher.id}, ${row.repo}, 1, ${Date.now() + 60_000})`
      yield* f.store.setThreadGit(pusher.id, { branch: 'feature', dirty: false })
      f.chrome.length = 0
      yield* links.linkPushed(pusher.id)
      expect(yield* f.store.threadsForPullRequest(row.repo, 1)).toEqual([pusher.id])
      expect(f.chrome.map((thread) => thread.id)).toEqual([owner.id])
      expect(refsOf(f.chrome[0])).toEqual([])
    })
  )
})

test('a worktree push follows the worktree branch, not the checkout branch', async () => {
  const f = await setup()
  const owner = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const pusher = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const idle = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  await f.run((links) =>
    Effect.gen(function* () {
      for (const [number, head] of [
        [1, 'feature'],
        [2, 'elsewhere'],
      ] as const) {
        const row = pull(number, head)
        yield* f.store.savePullRequest({
          repo: row.repo,
          number,
          status: 'ready',
          data: row.data,
          refreshedAt: Date.now(),
          dataRefreshedAt: Date.now(),
        })
        yield* f.store.linkPullRequest(owner.id, row.repo, number)
      }
      yield* f.store.setThreadEnvironment(pusher.id, 'abc')
      const record = yield* f.store.getWorktree(pusher.id)
      if (!record) return yield* Effect.die('worktree missing')
      yield* f.store.saveWorktree(pusher.id, { ...record, branch: 'feature' })
      yield* f.store.setThreadGit(pusher.id, { branch: 'elsewhere', dirty: false })
      const ready = yield* f.store.requireThread(pusher.id)
      expect(ready.environment).toBe('worktree')
      expect(ready.worktree?.branch).toBe('feature')
      expect(ready.git?.branch).toBe('elsewhere')
      f.chrome.length = 0
      yield* links.linkPushed(pusher.id)
      expect(yield* f.store.threadsForPullRequest('owner/repo', 1)).toEqual([pusher.id])
      expect(yield* f.store.threadsForPullRequest('owner/repo', 2)).toEqual([owner.id])
      expect(f.chrome.map((thread) => thread.id)).toEqual([pusher.id, owner.id])
      yield* f.store.setThreadEnvironment(idle.id, 'abc')
      yield* f.store.setThreadGit(idle.id, { branch: 'feature', dirty: false })
      const waiting = yield* f.store.requireThread(idle.id)
      expect(waiting.environment).toBe('worktree')
      expect(waiting.worktree?.branch).toBeNull()
      expect(waiting.git?.branch).toBe('feature')
      yield* links.linkPushed(idle.id)
      expect(yield* f.store.threadsForPullRequest('owner/repo', 1)).toEqual([pusher.id])
      expect(f.chrome).toHaveLength(2)
    })
  )
})

function shell(
  turn: { turnId: string; emit: Emit },
  command: string,
  output: string,
  options?: { status?: 'succeeded' | 'failed'; cmd?: boolean; agentId?: string }
) {
  const id = newId()
  return turn
    .emit({
      type: 'item.started',
      item: {
        id,
        turnId: turn.turnId,
        createdAt: Date.now(),
        kind: 'tool_call',
        toolName: 'Bash',
        input: options?.cmd ? { cmd: command } : { command },
        output: '',
        status: 'running',
        ...(options?.agentId ? { agentId: options.agentId } : {}),
      },
    })
    .pipe(
      Effect.andThen(
        turn.emit({
          type: 'item.completed',
          itemId: id,
          patch: { output, status: options?.status ?? 'succeeded' },
        })
      )
    )
}

test('shell output reports create as a takeover, view as a claim, and a successful push', async () => {
  const f = await setup()
  const thread = await f.runtime.runPromise(f.store.createThread(f.project.id, newId()))
  const seen = 'https://github.com/owner/repo/pull/12'
  await f.runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const notices = yield* Queue.unbounded<'claim' | 'transfer' | 'push'>()
        let turn: { turnId: string; emit: Emit; done: Deferred.Deferred<void> } | undefined
        const agent: Agent = {
          startTurn: (input, emit) =>
            Effect.gen(function* () {
              const done = yield* Deferred.make<void>()
              turn = { turnId: input.turnId, emit, done }
              yield* emit({ type: 'turn.started', turnId: input.turnId })
              return { await: Deferred.await(done) }
            }),
          steer: () => Effect.succeed(false),
          interrupt: () => Effect.void,
          respondToApproval: () => Effect.succeed(false),
          respondToQuestion: () => Effect.succeed(false),
        }
        const orch = yield* createOrchestrator({
          store: f.store,
          agent,
          hub: f.hub,
          onPullRequestOutput: (_threadId, _text, mode) =>
            Queue.offer(notices, mode).pipe(Effect.asVoid),
          onBranchPushed: () => Queue.offer(notices, 'push').pipe(Effect.asVoid),
        })
        yield* orch.startTurnEffect({ threadId: thread.id, text: 'ship it' })
        if (!turn) return yield* Effect.die('turn did not start')
        const report = turn
        yield* shell(report, 'gh pr view 12', seen)
        expect(yield* Queue.take(notices)).toBe('claim')
        yield* shell(report, 'gh pr create --fill', seen)
        expect(yield* Queue.take(notices)).toBe('transfer')
        yield* shell(report, 'gh pr view 4 && gh pr create', seen)
        expect(yield* Queue.take(notices)).toBe('transfer')
        yield* shell(report, 'git push -u origin HEAD', '')
        expect(yield* Queue.take(notices)).toBe('push')
        yield* shell(report, 'git push', '', { cmd: true })
        expect(yield* Queue.take(notices)).toBe('push')
        yield* shell(report, 'git push', 'rejected', { status: 'failed' })
        yield* shell(report, 'git push', '', { agentId: 'child' })
        yield* shell(report, 'echo git push && echo gh pr create', seen)
        yield* shell(report, 'gh pr view 1', 'pull request 1')
        yield* shell(report, 'cd app && git push', '')
        expect(yield* Queue.take(notices)).toBe('push')
        yield* Effect.sleep('50 millis')
        expect(yield* Queue.size(notices)).toBe(0)
        yield* Deferred.succeed(report.done, undefined)
      })
    )
  )
})
