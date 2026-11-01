import { Database } from 'bun:sqlite'

// Its own process, so the server keeps working however long a backup takes.
const [source, target] = process.argv.slice(2)
const db = new Database(source!)
db.exec('PRAGMA busy_timeout = 5000')
db.query('VACUUM INTO ?').run(target!)
db.close()
