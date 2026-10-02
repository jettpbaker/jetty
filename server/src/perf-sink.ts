import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const maxBodyBytes = 1024 * 1024
const maxFileBytes = 10 * 1024 * 1024
const keepFiles = 14
const kinds = new Set(['journey', 'mark', 'loaf', 'event', 'shift', 'ws', 'snapshot'])

type PerfRecord = {
  v: 1
  t: number
  sid: string
  k: string
  n: string
  d?: number
  jid?: string
  a?: Record<string, number | string | boolean>
}

const shortString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

const attributeValue = (value: unknown): value is number | string | boolean =>
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (typeof value === 'string' && value.length <= 128 * 1024)

function parseAttributes(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > 64) return undefined
  const attributes: Record<string, number | string | boolean> = {}
  for (const [key, item] of entries) {
    if (key.length > 64 || !attributeValue(item)) return undefined
    attributes[key] = item
  }
  return attributes
}

function parsePerfRecord(line: string): PerfRecord | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const { v, t, sid, k, n, d, jid, a } = value as Record<string, unknown>
  if (v !== 1 || typeof t !== 'number' || !Number.isFinite(t)) return undefined
  if (!shortString(sid, 64) || !shortString(n, 128) || typeof k !== 'string' || !kinds.has(k))
    return undefined
  if (d !== undefined && (typeof d !== 'number' || !Number.isFinite(d))) return undefined
  if (jid !== undefined && !shortString(jid, 64)) return undefined
  const attributes = a === undefined ? undefined : parseAttributes(a)
  if (a !== undefined && !attributes) return undefined
  return {
    v,
    t,
    sid,
    k,
    n,
    ...(d === undefined ? {} : { d }),
    ...(jid === undefined ? {} : { jid }),
    ...(attributes ? { a: attributes } : {}),
  }
}

async function readCapped(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return undefined
  if (!request.body) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body) {
    size += chunk.byteLength
    if (size > maxBodyBytes) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function localDay(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Appends field records to JETTY_HOME/perf/<day>[.<part>].ndjson, a new part every 10 MB.
export function createPerfSink(home: string) {
  const dir = join(home, 'perf')
  let current: { day: string; part: number; size: number } | undefined
  let writes = Promise.resolve()

  const fileName = (day: string, part: number) =>
    part === 0 ? `${day}.ndjson` : `${day}.${part}.ndjson`

  async function resume(day: string) {
    await mkdir(dir, { recursive: true })
    let part = 0
    for (const name of await readdir(dir)) {
      const match = name.match(/^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.ndjson$/)
      if (match?.[1] === day) part = Math.max(part, Number(match[2] ?? 0))
    }
    const size = await stat(join(dir, fileName(day, part))).then(
      (info) => info.size,
      () => 0
    )
    return { day, part, size }
  }

  async function prune() {
    const files = await Promise.all(
      (await readdir(dir))
        .filter((name) => name.endsWith('.ndjson'))
        .map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs }))
    )
    files.sort((a, b) => b.mtime - a.mtime)
    for (const file of files.slice(keepFiles)) await unlink(join(dir, file.name))
  }

  async function append(body: string) {
    const bytes = Buffer.byteLength(body)
    const day = localDay()
    let fresh = current?.day !== day
    if (!current || fresh) current = await resume(day)
    if (current.size > 0 && current.size + bytes > maxFileBytes) {
      current = { day, part: current.part + 1, size: 0 }
      fresh = true
    }
    await appendFile(join(dir, fileName(day, current.part)), body)
    current.size += bytes
    if (fresh) await prune()
  }

  return async function handle(request: Request): Promise<Response> {
    const text = await readCapped(request)
    if (text === undefined) return new Response('Payload too large', { status: 413 })
    let body = ''
    for (const line of text.split('\n')) {
      const record = line.trim() ? parsePerfRecord(line) : undefined
      if (record) body += `${JSON.stringify(record)}\n`
    }
    if (body) {
      writes = writes
        .then(() => append(body))
        .catch(() => {
          current = undefined
        })
      await writes
    }
    return new Response(null, { status: 204 })
  }
}
