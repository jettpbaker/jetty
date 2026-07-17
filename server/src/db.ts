import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function openDb(home: string): Database {
  mkdirSync(home, { recursive: true })
  const db = new Database(join(home, 'jetty.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      agent_session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS thread_events (
      thread_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, seq)
    );

    CREATE TABLE IF NOT EXISTS thread_states (
      thread_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      last_seq INTEGER NOT NULL
    );
  `)

  try {
    db.exec('ALTER TABLE threads ADD COLUMN agent_session_id TEXT')
  } catch {
    // column already exists on upgraded dbs
  }
}
