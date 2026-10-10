// Writes a thread's events from a Jetty home's database as a replay for /dev/feels, at their real
// timing: bun scripts/export-replay.ts <jetty.db> <thread-id> <name>
import { Database } from 'bun:sqlite'

const [path, threadId, name] = process.argv.slice(2)
if (!path || !threadId || !name) {
  console.error('usage: bun scripts/export-replay.ts <jetty.db> <thread-id> <name>')
  process.exit(1)
}

const db = new Database(path, { readonly: true })
const thread = db
  .query<{ title: string; provider: string | null; projectPath: string }, [string]>(
    `select threads.title, threads.provider, projects.path as projectPath
     from threads join projects on projects.id = threads.project_id where threads.id = ?`
  )
  .get(threadId)
const rows = db
  .query<{ ts: number; payload: string }, [string]>(
    'select ts, payload_json as payload from thread_events where thread_id = ? order by seq'
  )
  .all(threadId)
db.close()
if (!thread || rows.length === 0) {
  console.error(`No thread ${threadId} with events in ${path}`)
  process.exit(1)
}

const start = rows[0]!.ts
const replay = {
  title: thread.title,
  provider: thread.provider ?? undefined,
  projectPath: thread.projectPath,
  events: rows.map((row) => ({ t: row.ts - start, event: JSON.parse(row.payload) })),
}
const out = new URL(`../client/src/dev/replays/${name}.json`, import.meta.url)
await Bun.write(out, `${JSON.stringify(replay, null, 2)}\n`)
console.log(`${rows.length} events over ${rows.at(-1)!.ts - start}ms → ${out.pathname}`)
