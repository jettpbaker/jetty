import { Database } from 'bun:sqlite'

// This is a disposable cache. Bump the filename version when its shape changes.
export function searchFilename(botId: string) {
  return `${botId}.keyword-v1.sqlite`
}

export function openSearchDb(path: string) {
  const db = new Database(path, { create: true })
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, modified_at REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL, start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL, text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_by_path ON chunks(path);
    CREATE TABLE IF NOT EXISTS search_threads (id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS search_messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, author TEXT NOT NULL,
      assistant INTEGER NOT NULL, date TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS message_chunks (id INTEGER PRIMARY KEY, message_id TEXT NOT NULL, text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS message_chunks_by_message ON message_chunks(message_id);
    CREATE INDEX IF NOT EXISTS search_messages_by_thread ON search_messages(thread_id);`)
  return db
}
