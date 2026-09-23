import { BunFileSystem } from '@effect/platform-bun'
import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-bun'
import { Effect, FileSystem, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { join } from 'node:path'

function addThreadColumns(columns: Record<string, string>) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const existing = yield* sql<{ name: string }>`PRAGMA table_info(threads)`
    for (const [name, definition] of Object.entries(columns)) {
      if (existing.some((column) => column.name === name)) continue
      yield* sql.unsafe(`ALTER TABLE threads ADD COLUMN ${name} ${definition}`)
    }
  })
}

const migrations = SqliteMigrator.fromRecord({
  '001_initial': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL
    )`
    yield* sql`CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`
    yield* sql`CREATE TABLE IF NOT EXISTS thread_events (
      thread_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
      payload_json TEXT NOT NULL, PRIMARY KEY (thread_id, seq)
    )`
    yield* sql`CREATE TABLE IF NOT EXISTS thread_states (
      thread_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, last_seq INTEGER NOT NULL
    )`
  }),
  '002_agent_session': addThreadColumns({ agent_session_id: 'TEXT' }),
  '003_provider_sessions': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE provider_sessions (
      thread_id TEXT NOT NULL REFERENCES threads(id), provider TEXT NOT NULL,
      session_id TEXT NOT NULL, PRIMARY KEY (thread_id, provider)
    )`
  }),
  '004_thread_pin_title_lock': addThreadColumns({
    pinned: 'INTEGER NOT NULL DEFAULT 0',
    title_locked: 'INTEGER NOT NULL DEFAULT 0',
  }),
  '005_thread_provider': addThreadColumns({ provider: 'TEXT' }),
  '007_orchestration': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* addThreadColumns({
      parent_thread_id: 'TEXT',
      lineage_depth: 'INTEGER NOT NULL DEFAULT 0',
      created_by: "TEXT NOT NULL DEFAULT 'user'",
      notify_parent: 'INTEGER NOT NULL DEFAULT 0',
      pending_messages: "TEXT NOT NULL DEFAULT '[]'",
      permission_mode: 'TEXT',
    })
    yield* sql`CREATE TABLE orchestration_turns (
      turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, hop INTEGER NOT NULL,
      created_count INTEGER NOT NULL DEFAULT 0
    )`
    yield* sql`CREATE TABLE orchestration_requests (
      caller_id TEXT NOT NULL, request_id TEXT NOT NULL, operation TEXT NOT NULL,
      result_json TEXT NOT NULL, PRIMARY KEY(caller_id, request_id, operation)
    )`
  }),
  '006_thread_loadout': addThreadColumns({ model: 'TEXT', effort: 'TEXT', fast: 'INTEGER' }),
})

export function databaseLayer(home: string) {
  const client = Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.makeDirectory(home, { recursive: true })
      return SqliteClient.layer({ filename: join(home, 'jetty.db') })
    })
  ).pipe(Layer.provide(BunFileSystem.layer))
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`PRAGMA foreign_keys = ON`
      yield* SqliteMigrator.run({ loader: migrations })
    })
  ).pipe(Layer.provideMerge(client))
}
