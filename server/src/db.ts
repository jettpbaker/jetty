import { BunFileSystem } from '@effect/platform-bun'
import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-bun'
import { Effect, FileSystem, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { join } from 'node:path'

function addThreadColumns(columns: Record<string, string>) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const [name, definition] of Object.entries(columns)) {
      yield* sql.unsafe(`ALTER TABLE threads ADD COLUMN ${name} ${definition}`)
    }
  })
}

const migrations = SqliteMigrator.fromRecord({
  '001_initial': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE projects (
      id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL
    )`
    yield* sql`CREATE TABLE threads (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`
    yield* sql`CREATE TABLE thread_events (
      thread_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
      payload_json TEXT NOT NULL, PRIMARY KEY (thread_id, seq)
    )`
    yield* sql`CREATE TABLE thread_states (
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
  '006_thread_loadout': addThreadColumns({ model: 'TEXT', effort: 'TEXT', fast: 'INTEGER' }),
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
  '008_turn_initiator': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE orchestration_turns ADD COLUMN initiator_thread_id TEXT`
  }),
  '009_attachment_refs': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE attachment_refs (
      thread_id TEXT NOT NULL, attachment_id TEXT NOT NULL, metadata_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, attachment_id)
    )`
    yield* sql`CREATE INDEX attachment_refs_by_id ON attachment_refs (attachment_id)`
    yield* sql`INSERT OR IGNORE INTO attachment_refs
      SELECT s.thread_id, json_extract(a.value, '$.id'), a.value
      FROM thread_states s, json_each(s.state_json, '$.items') i,
      json_each(CASE json_extract(i.value, '$.kind')
        WHEN 'user_message' THEN json_extract(i.value, '$.attachments')
        WHEN 'image_gallery' THEN json_extract(i.value, '$.images')
        WHEN 'video' THEN json_array(json_extract(i.value, '$.video'))
        ELSE '[]' END) a`
  }),
  '010_thread_turn_times': addThreadColumns({
    turn_started_at: 'INTEGER',
    turn_ended_at: 'INTEGER',
  }),
  '011_project_icon': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE projects ADD COLUMN icon TEXT`
  }),
  '012_queue_pause': addThreadColumns({ queue_paused: 'INTEGER NOT NULL DEFAULT 0' }),
  '013_pull_requests': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE pull_requests (
      repo TEXT NOT NULL, number INTEGER NOT NULL, data_json TEXT,
      status TEXT NOT NULL DEFAULT 'loading', error TEXT, refreshed_at INTEGER,
      PRIMARY KEY (repo, number)
    )`
    yield* sql`CREATE TABLE thread_pull_requests (
      thread_id TEXT NOT NULL REFERENCES threads(id), repo TEXT NOT NULL,
      number INTEGER NOT NULL, linked_at INTEGER NOT NULL,
      PRIMARY KEY (thread_id, repo, number),
      FOREIGN KEY (repo, number) REFERENCES pull_requests(repo, number)
    )`
    yield* sql`CREATE INDEX thread_pull_requests_by_pr ON thread_pull_requests (repo, number)`
  }),
  '014_thread_review': addThreadColumns({
    ready_for_review: 'INTEGER NOT NULL DEFAULT 0',
    review_seen_at: 'INTEGER NOT NULL DEFAULT 0',
  }),
  '015_containers': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE threads ADD COLUMN environment TEXT NOT NULL DEFAULT 'local'`
    yield* sql`ALTER TABLE threads ADD COLUMN base_commit TEXT`
    yield* sql`ALTER TABLE projects ADD COLUMN container_registration TEXT`
    yield* sql`CREATE TABLE environments (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id),
      recipe_json TEXT NOT NULL, image_id TEXT NOT NULL, base_commit TEXT NOT NULL,
      checkout_path TEXT NOT NULL, home_path TEXT NOT NULL, artifacts_path TEXT NOT NULL,
      container_id TEXT, state TEXT NOT NULL, last_error TEXT
    )`
  }),
  '016_settings': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`
  }),
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
