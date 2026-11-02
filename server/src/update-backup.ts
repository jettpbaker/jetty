import { Database } from 'bun:sqlite'
import { renameSync, rmSync } from 'node:fs'

// Its own process, so the server keeps working, and an update that leaves the database's layout
// alone can restart without waiting for it.
const [source, target] = process.argv.slice(2)
// Named for its target only when whole, so a killed backup can't pass for a good one.
const partial = `${target}.partial`
const started = Date.now()
try {
  const db = new Database(source!)
  db.exec('PRAGMA busy_timeout = 5000')
  db.query('VACUUM INTO ?').run(partial)
  db.close()
  renameSync(partial, target!)
  console.log(`[update] database backup took ${((Date.now() - started) / 1000).toFixed(1)}s`)
} catch (error) {
  rmSync(partial, { force: true })
  console.error(`[update] database backup failed: ${String(error)}`)
  process.exit(1)
}
