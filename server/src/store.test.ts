import { BunServices } from '@effect/platform-bun'
import { applyEvent, emptyThread } from '@jetty/shared/reducer'
import { newId } from '@jetty/shared/wire'
import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { Deferred, Effect, FileSystem } from 'effect'
import { SqlClient } from 'effect/sql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStore } from './store'
import { openTestStore } from './store-fixture'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'jetty-sql-'))
  cleanup.push(async () => {
    rmSync(home, { recursive: true, force: true })
  })
  const fixture = await openTestStore(home)
  cleanup.push(fixture.close)
  const { store, runtime } = fixture
  const sql = await runtime.runPromise(SqlClient.SqlClient)
  const project = await runtime.runPromise(store.createProject(home))
  const thread = await runtime.runPromise(store.createThread(project.id, newId()))
  return { ...fixture, home, project, thread, sql }
}

test('project directory validation uses injected filesystem without holding a SQL transaction', async () => {
  const { home, runtime, sql } = await setup()
  const entered = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  const store = await Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return yield* createStore().pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          stat: (path) =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(fs.stat(path))
            ),
        })
      )
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )
  const pending = runtime.runPromise(store.createProject(home))
  try {
    await runtime.runPromise(Deferred.await(entered))
    expect(
      await runtime.runPromise(
        sql`SELECT 1 AS value`.pipe(sql.withTransaction, Effect.timeout('1 second'))
      )
    ).toEqual([{ value: 1 }])
  } finally {
    await runtime.runPromise(Deferred.succeed(release, undefined))
  }
  expect((await pending).path).toBe(home)
})

test('concurrent SQL appends serialize durable sequences and reduced projection order', async () => {
  const { store, runtime, thread } = await setup()
  const appends = await runtime.runPromise(
    Effect.all(
      Array.from({ length: 60 }, (_, index) =>
        store.appendEvent(thread.id, {
          type: 'item.started',
          item: {
            id: `message-${index}`,
            turnId: 'turn',
            createdAt: index,
            kind: 'assistant_message',
            text: String(index),
          },
        })
      ),
      { concurrency: 'unbounded' }
    )
  )
  const events = await runtime.runPromise(store.getEventsAfter(thread.id, 0))
  expect(events.map(({ seq }) => seq)).toEqual(Array.from({ length: 60 }, (_, index) => index + 1))
  expect(new Set(appends.map(({ seq }) => seq)).size).toBe(60)
  expect(await runtime.runPromise(store.getThreadState(thread.id))).toEqual(
    events.reduce(applyEvent, emptyThread)
  )
  const sorted = appends.toSorted((a, b) => a.seq - b.seq)
  for (const appended of sorted) {
    expect(appended.state).toEqual(events.slice(0, appended.seq).reduce(applyEvent, emptyThread))
  }
})

for (const table of ['thread_events', 'threads']) {
  test(`SQL failure at ${table} rolls back event, snapshot and thread metadata`, async () => {
    const { store, runtime, thread, sql } = await setup()
    const beforeThread = await runtime.runPromise(store.getThread(thread.id))
    const beforeState = await runtime.runPromise(store.getThreadState(thread.id))
    await runtime.runPromise(
      sql.unsafe(
        `CREATE TRIGGER reject_write BEFORE ${table === 'threads' ? 'UPDATE' : 'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`
      )
    )
    await expect(
      runtime.runPromise(store.appendEvent(thread.id, { type: 'turn.started', turnId: 'failed' }))
    ).rejects.toMatchObject({ code: 'internal' })
    expect(await runtime.runPromise(store.getEventsAfter(thread.id, 0))).toEqual([])
    expect(await runtime.runPromise(store.getThreadState(thread.id))).toEqual(beforeState)
    expect(await runtime.runPromise(store.getThread(thread.id))).toEqual(beforeThread)
    await runtime.runPromise(sql`DROP TRIGGER reject_write`)
    expect(
      (
        await runtime.runPromise(
          store.appendEvent(thread.id, { type: 'turn.started', turnId: 'retry' })
        )
      ).seq
    ).toBe(1)
  })
}

test('a failed COMMIT leaves no uncommitted events in the cached state', async () => {
  const { store, runtime, thread, sql } = await setup()
  const before = await runtime.runPromise(store.getThreadState(thread.id))
  await expect(
    runtime.runPromise(
      store.transaction(
        Effect.gen(function* () {
          // A deferred foreign key is only checked at COMMIT, so the body succeeds and COMMIT fails.
          yield* sql`PRAGMA defer_foreign_keys = ON`
          yield* sql`INSERT INTO provider_sessions (thread_id, provider, session_id) VALUES ('missing', 'claude', 'session')`
          yield* store.appendEvent(thread.id, { type: 'turn.started', turnId: 'phantom' })
        })
      )
    )
  ).rejects.toThrow()
  expect(await runtime.runPromise(store.getEventsAfter(thread.id, 0))).toEqual([])
  expect(await runtime.runPromise(store.getThreadState(thread.id))).toEqual(before)
  const next = await runtime.runPromise(
    store.appendEvent(thread.id, { type: 'turn.started', turnId: 'real' })
  )
  expect(next.seq).toBe(1)
})

test('invalid merged item patches roll back their event and projection', async () => {
  const { store, runtime, thread } = await setup()
  await runtime.runPromise(
    store.appendEvent(thread.id, {
      type: 'item.started',
      item: {
        id: 'assistant',
        turnId: 'turn',
        createdAt: 1,
        kind: 'assistant_message',
        text: 'original',
      },
    })
  )
  const before = await runtime.runPromise(store.getThreadState(thread.id))
  await expect(
    runtime.runPromise(
      store.appendEvent(thread.id, {
        type: 'item.completed',
        itemId: 'assistant',
        patch: { text: 123 },
      })
    )
  ).rejects.toMatchObject({ code: 'invalid_params' })
  expect(await runtime.runPromise(store.getThreadState(thread.id))).toEqual(before)
  expect(await runtime.runPromise(store.getEventsAfter(thread.id, 0))).toHaveLength(1)
})

test('a failed second batch update rolls back every event, projection and metadata change', async () => {
  const { store, runtime, thread, sql } = await setup()
  const before = await runtime.runPromise(store.getThread(thread.id))
  await runtime.runPromise(sql`CREATE TRIGGER reject_second_status BEFORE UPDATE ON threads
    WHEN NEW.status = 'awaiting_approval' BEGIN SELECT RAISE(ABORT, 'second update failed'); END`)
  const batch = store.appendEvents(thread.id, [
    { type: 'turn.started', turnId: 'batch' },
    { type: 'session.status', status: 'awaiting_approval' },
  ])
  await expect(runtime.runPromise(batch)).rejects.toMatchObject({ code: 'internal' })
  expect(await runtime.runPromise(store.getEventsAfter(thread.id, 0))).toEqual([])
  expect(await runtime.runPromise(store.getThreadState(thread.id))).toEqual(emptyThread)
  expect(await runtime.runPromise(store.getThread(thread.id))).toEqual(before)
  await runtime.runPromise(sql`DROP TRIGGER reject_second_status`)
  const committed = await runtime.runPromise(batch)
  expect(committed.map(({ seq }) => seq)).toEqual([1, 2])
  expect(committed.map(({ state }) => state.status)).toEqual(['running', 'awaiting_approval'])
  expect(await runtime.runPromise(store.getThreadState(thread.id))).toEqual(committed[1]!.state)
  expect(await runtime.runPromise(store.getThread(thread.id))).toEqual(committed[1]!.thread)
})

test('non-JSON event payloads fail with a typed error and no partial writes', async () => {
  const { store, runtime, thread } = await setup()
  await expect(
    runtime.runPromise(
      store.appendEvent(thread.id, {
        type: 'item.started',
        item: {
          id: 'tool',
          turnId: 'turn',
          createdAt: 0,
          kind: 'tool_call',
          toolName: 'test',
          input: { invalid: 1n },
          output: '',
          status: 'running',
        },
      })
    )
  ).rejects.toMatchObject({ code: 'internal' })
  expect(await runtime.runPromise(store.getEventsAfter(thread.id, 0))).toEqual([])
  expect(await runtime.runPromise(store.getThreadState(thread.id))).toEqual(emptyThread)
})

test('thread creation is atomic, concurrently idempotent, and preserves existing metadata', async () => {
  const { store, runtime, project, sql } = await setup()
  const id = newId()
  await runtime.runPromise(
    sql`CREATE TRIGGER reject_state BEFORE INSERT ON thread_states BEGIN SELECT RAISE(ABORT, 'injected state failure'); END`
  )
  await expect(runtime.runPromise(store.createThread(project.id, id))).rejects.toMatchObject({
    code: 'internal',
  })
  expect(await runtime.runPromise(store.getThread(id))).toBeNull()
  expect(
    await runtime.runPromise(sql`SELECT * FROM thread_states WHERE thread_id = ${id}`)
  ).toEqual([])
  await runtime.runPromise(sql`DROP TRIGGER reject_state`)
  const created = await runtime.runPromise(
    Effect.all(
      Array.from({ length: 20 }, () => store.createThread(project.id, id)),
      { concurrency: 'unbounded' }
    )
  )
  expect(created.every((thread) => JSON.stringify(thread) === JSON.stringify(created[0]))).toBe(
    true
  )
  await runtime.runPromise(store.setThreadTitle(id, 'Renamed'))
  await runtime.runPromise(store.appendEvent(id, { type: 'turn.started', turnId: 'active' }))
  expect((await runtime.runPromise(store.createThread(project.id, id))).title).toBe('Renamed')
  expect((await runtime.runPromise(store.getThreadState(id))).lastSeq).toBe(1)
  expect(await runtime.runPromise(sql`SELECT * FROM threads WHERE id = ${id}`)).toHaveLength(1)
  await runtime.runPromise(
    sql`INSERT INTO projects (id, path, title, created_at) VALUES ('other', '/other', 'Other', 0)`
  )
  await expect(runtime.runPromise(store.createThread('other', id))).rejects.toMatchObject({
    code: 'invalid_params',
  })
  await expect(runtime.runPromise(store.createThread('missing', newId()))).rejects.toMatchObject({
    code: 'not_found',
  })
})

test('repeat migration and reopen preserve events, snapshots and session pointers and close SQL', async () => {
  const { store, runtime, home, thread, close } = await setup()
  await runtime.runPromise(store.appendEvent(thread.id, { type: 'turn.started', turnId: 'active' }))
  await runtime.runPromise(store.setThreadSessionId(thread.id, 'session-id'))
  await runtime.runPromise(store.setProviderSessionId(thread.id, 'codex', 'codex-id'))
  const before = await runtime.runPromise(store.getThreadState(thread.id))
  await close()
  await expect(Effect.runPromise(store.getThreadState(thread.id))).rejects.toMatchObject({
    code: 'internal',
  })
  for (let iteration = 0; iteration < 2; iteration++) {
    const reopened = await openTestStore(home)
    try {
      expect(await reopened.runtime.runPromise(reopened.store.getThreadState(thread.id))).toEqual(
        before
      )
      expect(await reopened.runtime.runPromise(reopened.store.getThreadSessionId(thread.id))).toBe(
        'session-id'
      )
      expect(
        await reopened.runtime.runPromise(reopened.store.getEventsAfter(thread.id, 0))
      ).toHaveLength(1)
      expect(
        await reopened.runtime.runPromise(reopened.store.getProviderSessionId(thread.id, 'codex'))
      ).toBe('codex-id')
      const migrations = await reopened.runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{
            migration_id: number
          }>`SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id`
        })
      )
      expect(migrations.map((row) => row.migration_id)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
        26, 27, 28, 29, 30, 31, 32,
      ])
    } finally {
      await reopened.close()
    }
  }
})

for (const invalid of [
  'not json',
  '{}',
  '{"items":[],"status":"unknown","activeTurnId":null,"lastSeq":0}',
]) {
  test(`invalid persisted snapshot is surfaced: ${invalid}`, async () => {
    const { store, runtime, sql, thread } = await setup()
    await runtime.runPromise(
      sql`UPDATE thread_states SET state_json = ${invalid} WHERE thread_id = ${thread.id}`
    )
    await expect(runtime.runPromise(store.getThreadState(thread.id))).rejects.toMatchObject({
      code: 'internal',
    })
    await expect(
      runtime.runPromise(store.appendEvent(thread.id, { type: 'turn.started', turnId: 'new' }))
    ).rejects.toMatchObject({ code: 'internal' })
    expect(await runtime.runPromise(store.getEventsAfter(thread.id, 0))).toEqual([])
  })
}

test('invalid persisted event JSON is surfaced', async () => {
  const { store, runtime, sql, thread } = await setup()
  await runtime.runPromise(store.appendEvent(thread.id, { type: 'turn.started', turnId: 'active' }))
  for (const invalid of ['not json', '{"type":"unknown"}']) {
    await runtime.runPromise(
      sql`UPDATE thread_events SET payload_json = ${invalid} WHERE thread_id = ${thread.id}`
    )
    await expect(runtime.runPromise(store.getEventsAfter(thread.id, 0))).rejects.toMatchObject({
      code: 'internal',
    })
  }
})

test('a snapshot behind the event log catches up by replaying the log', async () => {
  const { store, runtime, sql, thread, home, close } = await setup()
  await runtime.runPromise(
    sql`CREATE TRIGGER freeze_snapshot BEFORE UPDATE ON thread_states BEGIN SELECT RAISE(IGNORE); END`
  )
  await runtime.runPromise(
    store.appendEvents(thread.id, [
      { type: 'turn.started', turnId: 'active' },
      {
        type: 'item.started',
        item: { id: 'reply', turnId: 'active', createdAt: 1, kind: 'assistant_message', text: '' },
      },
      { type: 'item.delta', itemId: 'reply', delta: 'hello' },
    ])
  )
  const events = await runtime.runPromise(store.getEventsAfter(thread.id, 0))
  await close()
  const reopened = await openTestStore(home)
  try {
    expect(await reopened.runtime.runPromise(reopened.store.getThreadState(thread.id))).toEqual(
      events.reduce(applyEvent, emptyThread)
    )
  } finally {
    await reopened.close()
  }
})

test('migration errors fail honestly and roll back the migration ledger', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jetty-invalid-migration-'))
  cleanup.push(async () => {
    rmSync(home, { recursive: true, force: true })
  })
  const db = new Database(join(home, 'jetty.db'))
  try {
    db.run('CREATE VIEW threads AS SELECT 1 AS id')
    await expect(openTestStore(home)).rejects.toThrow()
    expect(db.query('SELECT * FROM effect_sql_migrations').all()).toEqual([])
    db.run('DROP VIEW threads')
  } finally {
    db.close()
  }
  const fixture = await openTestStore(home)
  cleanup.push(fixture.close)
  expect(await fixture.runtime.runPromise(fixture.store.listThreads())).toEqual([])
})

test('active PR link pages reach every linked PR beyond the first hundred', async () => {
  const { store, runtime, thread, sql } = await setup()
  const expected: { repo: string; number: number }[] = []
  for (const [repo, count] of [
    ['owner/a', 150],
    ['owner/b', 55],
  ] as const) {
    for (let number = 1; number <= count; number++) {
      await runtime.runPromise(store.linkPullRequest(thread.id, repo, number))
      expected.push({ repo, number })
    }
  }
  const archived = await runtime.runPromise(store.createThread(thread.projectId, newId()))
  await runtime.runPromise(store.linkPullRequest(archived.id, 'owner/b', 56))
  await runtime.runPromise(store.archiveThread(archived.id, true))
  await runtime.runPromise(store.linkPullRequest(thread.id, 'owner/b', 57))
  await runtime.runPromise(
    sql`UPDATE pull_requests SET data_json = ${JSON.stringify({ pull: { state: 'closed', merged: true } })} WHERE repo = 'owner/b' AND number = 57`
  )
  const first = await runtime.runPromise(store.activePullRequestLinks())
  const second = await runtime.runPromise(store.activePullRequestLinks(first.at(-1)))
  const third = await runtime.runPromise(store.activePullRequestLinks(second.at(-1)))
  expect([first.length, second.length, third.length]).toEqual([100, 100, 5])
  expect([...first, ...second, ...third]).toEqual(expected)
  expect(await runtime.runPromise(store.activePullRequestLinks(third.at(-1)))).toEqual([])
  expect(await runtime.runPromise(store.activePullRequestLinks())).toEqual(first)
})

for (const fromUser of [true, false]) {
  test(`bot activity follows running say calls during ${fromUser ? 'user' : 'background'} turns`, async () => {
    const { store, runtime, home, sql } = await setup()
    const id = newId()
    await runtime.runPromise(
      store.createBotRecord(
        {
          id,
          name: 'Verify',
          shape: 'circle',
          color: 'coral',
          provider: 'claude',
          model: 'sonnet',
          fast: false,
          projectId: null,
          permissionMode: 'auto',
        },
        join(home, 'bots', id)
      )
    )
    await runtime.runPromise(sql`UPDATE bots SET seen_at = 0 WHERE id = ${id}`)
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('idle')
    const turnId = newId()
    await runtime.runPromise(
      store.appendEvents(id, [
        { type: 'turn.started', turnId },
        {
          type: 'item.started',
          item: {
            id: newId(),
            turnId,
            createdAt: Date.now(),
            kind: 'user_message',
            text: 'Hello',
            attachments: [],
            ...(!fromUser && { from: { threadId: 'worker', title: 'Worker' } }),
          },
        },
        {
          type: 'item.started',
          item: {
            id: newId(),
            turnId,
            createdAt: Date.now(),
            kind: 'assistant_message',
            text: 'Notes',
            private: true,
            streaming: true,
          },
        },
      ])
    )
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('working')
    const sayId = newId()
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.started',
        item: {
          id: sayId,
          turnId,
          createdAt: Date.now(),
          kind: 'tool_call',
          toolName: 'mcp__jetty__say',
          input: {},
          output: '',
          status: 'running',
        },
      })
    )
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('typing')
    const questionId = newId()
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.started',
        item: { id: questionId, turnId, createdAt: Date.now(), kind: 'question', questions: [] },
      })
    )
    expect(await runtime.runPromise(store.getBot(id))).toMatchObject({
      activity: 'idle',
      needsYou: true,
    })
    await runtime.runPromise(
      store.appendEvent(id, { type: 'item.updated', itemId: questionId, patch: { answers: {} } })
    )
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('typing')
    const workId = newId()
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.started',
        item: {
          id: workId,
          turnId,
          createdAt: Date.now(),
          kind: 'tool_call',
          toolName: 'Read',
          input: {},
          output: '',
          status: 'running',
        },
      })
    )
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('typing')
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.completed',
        itemId: sayId,
        patch: { status: 'succeeded' },
      })
    )
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('working')
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.completed',
        itemId: workId,
        patch: { status: 'succeeded' },
      })
    )
    const compactionId = newId()
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.started',
        item: {
          id: compactionId,
          turnId,
          createdAt: Date.now(),
          kind: 'compaction',
          status: 'running',
        },
      })
    )
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('tidying')
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.completed',
        itemId: compactionId,
        patch: { status: 'completed' },
      })
    )
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('working')
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.started',
        item: {
          id: newId(),
          turnId,
          createdAt: Date.now(),
          kind: 'tool_call',
          toolName: 'mcp__jetty__say',
          input: {},
          output: '',
          status: 'running',
        },
      })
    )
    await runtime.runPromise(store.appendEvent(id, { type: 'turn.completed', turnId }))
    expect(await runtime.runPromise(store.getBot(id))).toMatchObject({
      activity: 'idle',
      unread: false,
    })
    const fallbackId = newId()
    await runtime.runPromise(
      store.appendEvent(id, {
        type: 'item.started',
        item: {
          id: fallbackId,
          turnId,
          createdAt: Date.now(),
          kind: 'assistant_message',
          text: 'Fallback',
          private: true,
        },
      })
    )
    expect((await runtime.runPromise(store.getBot(id)))?.unread).toBe(false)
    await runtime.runPromise(
      store.appendEvent(id, { type: 'item.updated', itemId: fallbackId, patch: { private: false } })
    )
    expect((await runtime.runPromise(store.getBot(id)))?.unread).toBe(true)
    await runtime.runPromise(store.markBotSeen(id))
    expect((await runtime.runPromise(store.getBot(id)))?.unread).toBe(false)
    const nextTurn = newId()
    await runtime.runPromise(store.appendEvent(id, { type: 'turn.started', turnId: nextTurn }))
    expect((await runtime.runPromise(store.getBot(id)))?.activity).toBe('working')
  })
}
