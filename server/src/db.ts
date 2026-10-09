import { BunFileSystem } from '@effect/platform-bun'
import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-bun'
import { Effect, FileSystem, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
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
  '017_pull_request_lists': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE pull_request_lists (
      tab TEXT PRIMARY KEY, items_json TEXT,
      status TEXT NOT NULL DEFAULT 'loading', error TEXT, refreshed_at INTEGER
    )`
  }),
  '018_pull_request_lists_truncated': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE pull_request_lists ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0`
  }),
  '019_remove_containers': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const [table, key] of [
      ['attachment_refs', 'thread_id'],
      ['orchestration_turns', 'thread_id'],
      ['orchestration_requests', 'caller_id'],
      ['provider_sessions', 'thread_id'],
      ['thread_pull_requests', 'thread_id'],
      ['thread_events', 'thread_id'],
      ['thread_states', 'thread_id'],
    ]) {
      yield* sql.unsafe(
        `DELETE FROM ${table} WHERE ${key} IN (SELECT id FROM threads WHERE environment = 'container')`
      )
    }
    yield* sql`DROP TABLE environments`
    yield* sql`DELETE FROM threads WHERE environment = 'container'`
    yield* sql`DELETE FROM pull_requests WHERE NOT EXISTS (
      SELECT 1 FROM thread_pull_requests l WHERE l.repo = pull_requests.repo AND l.number = pull_requests.number
    )`
    yield* sql`ALTER TABLE projects DROP COLUMN container_registration`
    yield* sql`ALTER TABLE threads DROP COLUMN base_commit`
  }),
  '020_worktrees': addThreadColumns({ worktree_json: 'TEXT', git_json: 'TEXT' }),
  // Rewind checkpoints shipped briefly and were removed; their snapshots rebuild from the log.
  '021_remove_checkpoints': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const kinds = sql.in(['checkpoint.captured', 'turn.boundary', 'thread.rewound'])
    yield* sql`DELETE FROM thread_states WHERE thread_id IN (
      SELECT thread_id FROM thread_events WHERE json_extract(payload_json, '$.type') IN ${kinds}
    )`
    yield* sql`DELETE FROM thread_events WHERE json_extract(payload_json, '$.type') IN ${kinds}`
  }),
  '022_server_starts': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE server_starts (started_at INTEGER NOT NULL)`
    yield* sql`CREATE INDEX server_starts_by_time ON server_starts (started_at)`
  }),
  '023_archive_group': addThreadColumns({ archive_group: 'TEXT' }),
  '024_ask_parent': addThreadColumns({
    parent_question: 'TEXT',
    awaiting_parent: 'INTEGER NOT NULL DEFAULT 0',
  }),
  // A snapshot from before turn outcomes were tracked kept replaying on its old projection,
  // without them or item completion times; those rebuild from the event log.
  '025_rebuild_old_snapshots': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DELETE FROM thread_states WHERE json_type(state_json, '$.lastTurnOutcome') IS NULL`
  }),
  '026_pull_request_watch': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE pull_requests ADD COLUMN watch_json TEXT`
  }),
  '027_pull_request_data_refresh': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE pull_requests ADD COLUMN data_refreshed_at INTEGER`
    yield* sql`UPDATE pull_requests SET data_refreshed_at = refreshed_at
      WHERE status = 'ready' AND data_json IS NOT NULL`
  }),
  '028_deleted_threads': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE deleted_threads (id TEXT PRIMARY KEY COLLATE NOCASE)`
  }),
  '029_message_receipts': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE message_receipts (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, message_id)
    )`
  }),
  '030_live_background': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE live_background (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE
    )`
  }),
  '031_bots': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE projects ADD COLUMN bot_id TEXT`
    yield* sql`ALTER TABLE threads ADD COLUMN bot_id TEXT`
    yield* sql`CREATE TABLE bots (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, shape TEXT NOT NULL, color TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, effort TEXT, fast INTEGER NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      permission_mode TEXT NOT NULL, created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL
    )`
    yield* sql`CREATE INDEX threads_by_bot ON threads(bot_id)`
  }),
  '032_pull_request_guides': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE pull_request_guides (
      repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
      status TEXT NOT NULL, guide_json TEXT, model TEXT, metrics_json TEXT, error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (repo, number, head_sha)
    )`
  }),
  '033_bot_tasks': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE bot_tasks (
      id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      title TEXT NOT NULL, status TEXT NOT NULL, note TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
    )`
    yield* sql`CREATE INDEX bot_tasks_by_bot ON bot_tasks(bot_id)`
  }),
  '034_quiet_threads': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE threads ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0`
    yield* sql`ALTER TABLE threads ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0`
    yield* sql`ALTER TABLE threads ADD COLUMN lands_on TEXT`
  }),
  // A message quotes a list of replies, not one: each stored replyTo becomes a one-item replies.
  '035_reply_lists': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const listed = (value: string) =>
      `CASE WHEN json_type(${value}, '$.replyTo') = 'object'
        THEN json_set(json_remove(${value}, '$.replyTo'), '$.replies',
          json_array(json(json_extract(${value}, '$.replyTo'))))
        ELSE json(${value}) END`
    yield* sql.unsafe(`UPDATE thread_events
      SET payload_json = json_set(payload_json, '$.item', ${listed("json_extract(payload_json, '$.item')")})
      WHERE json_type(payload_json, '$.item.replyTo') = 'object'`)
    yield* sql.unsafe(`UPDATE thread_states
      SET state_json = json_set(state_json, '$.items', (
        SELECT json_group_array(${listed('i.value')} ORDER BY i.key)
        FROM json_each(thread_states.state_json, '$.items') i))
      WHERE EXISTS (SELECT 1 FROM json_each(thread_states.state_json, '$.items') i
        WHERE json_type(i.value, '$.replyTo') = 'object')`)
    yield* sql.unsafe(`UPDATE threads
      SET pending_messages = (
        SELECT json_group_array(${listed('m.value')} ORDER BY m.key)
        FROM json_each(threads.pending_messages) m)
      WHERE EXISTS (SELECT 1 FROM json_each(threads.pending_messages) m
        WHERE json_type(m.value, '$.replyTo') = 'object')`)
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
