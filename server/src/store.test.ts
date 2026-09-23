import { BunServices } from '@effect/platform-bun'
import { applyEvent, emptyThread } from '@jetty/shared/reducer'
import { newId } from '@jetty/shared/wire'
import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { Deferred, Effect, FileSystem } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
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
    }).pipe(Effect.provide(BunServices.layer))
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

for (const table of ['thread_events', 'thread_states', 'threads']) {
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
  ).rejects.toMatchObject({ code: 'internal' })
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
  await runtime.runPromise(sql`INSERT INTO projects VALUES ('other', '/other', 'Other', 0)`)
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
      expect(migrations.map((row) => row.migration_id)).toEqual([1, 2, 3, 4, 5])
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

test('invalid persisted event JSON and mismatched snapshot sequences are surfaced', async () => {
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
  await runtime.runPromise(
    sql`UPDATE thread_states SET last_seq = 99 WHERE thread_id = ${thread.id}`
  )
  await expect(runtime.runPromise(store.getThreadState(thread.id))).rejects.toMatchObject({
    code: 'internal',
  })
})

for (const hasSessionColumn of [false, true]) {
  test(`migrations preserve existing schema with session column ${hasSessionColumn}`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'jetty-existing-sql-'))
    cleanup.push(async () => {
      rmSync(home, { recursive: true, force: true })
    })
    const old = new Database(join(home, 'jetty.db'))
    old.run(
      `CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL)`
    )
    old.run(`INSERT INTO projects VALUES ('existing', '/existing', 'Existing', 1)`)
    old.run(
      `CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL${hasSessionColumn ? ', agent_session_id TEXT' : ''})`
    )
    old.close()
    const fixture = await openTestStore(home)
    cleanup.push(fixture.close)
    expect(await fixture.runtime.runPromise(fixture.store.listProjects())).toEqual([
      { id: 'existing', path: '/existing', title: 'Existing', createdAt: 1 },
    ])
    await fixture.runtime.runPromise(fixture.store.createThread('existing', 'thread'))
    await fixture.runtime.runPromise(fixture.store.setThreadSessionId('thread', 'saved'))
    expect(await fixture.runtime.runPromise(fixture.store.getThreadSessionId('thread'))).toBe(
      'saved'
    )
  })
}

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
