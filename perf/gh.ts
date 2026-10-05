// Fake `gh` (run through perf/bin/gh on the lab server's PATH). Replays recorded responses
// keyed by normalised arguments and stdin; in record mode it runs the real gh once and saves
// what it said. A replay miss fails like an unreachable API and is logged for the lab.
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

type Fixture = { args: string[]; stdin?: string; code: number; stdout: string; stderr: string }

const mode = process.env.PERF_GH_MODE ?? 'replay'
const dir = process.env.PERF_GH_FIXTURES ?? join(import.meta.dir, 'fixtures/gh')
const args = Bun.argv.slice(2).map((arg) => arg.replace(/\s+/g, ' ').trim())
const stdin = process.stdin.isTTY ? '' : await Bun.stdin.text()
const hash = new Bun.CryptoHasher('sha256')
  .update(JSON.stringify({ args, stdin }))
  .digest('hex')
  .slice(0, 16)
const slug = args
  .join(' ')
  .replace(/--hostname \S+ |--include /g, '')
  .replace(/query=.*/, 'graphql')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .slice(0, 60)
  .replace(/^-|-$/g, '')

function redact(text: string) {
  return text
    .replace(/\bgh[opsur]_[A-Za-z0-9_]+/g, 'gh*_REDACTED')
    .replace(/([?&]token=)[A-Za-z0-9_]+/g, '$1REDACTED')
}

async function emit(fixture: Pick<Fixture, 'code' | 'stdout' | 'stderr'>): Promise<never> {
  await Bun.write(Bun.stdout, fixture.stdout)
  await Bun.write(Bun.stderr, fixture.stderr)
  process.exit(fixture.code)
}

// The lab never hands out the login: what the server fetched with it would bypass the fixtures.
if (args[0] === 'auth' && args[1] === 'token')
  await emit({ code: 1, stdout: '', stderr: 'perf gh: no token in the lab\n' })

if (mode === 'record') {
  const real = process.env.PERF_GH_REAL
  if (!real) await emit({ code: 1, stdout: '', stderr: 'perf gh: no real gh to record from\n' })
  const child = Bun.spawn([real!, ...Bun.argv.slice(2)], {
    stdin: stdin ? new Blob([stdin]) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const fixture: Fixture = {
    args,
    ...(stdin ? { stdin } : {}),
    code,
    stdout: redact(stdout),
    stderr: redact(stderr),
  }
  mkdirSync(dir, { recursive: true })
  await Bun.write(join(dir, `${slug}-${hash}.json`), `${JSON.stringify(fixture, null, 2)}\n`)
  await emit({ code, stdout, stderr })
}

const fallback = join(import.meta.dir, 'fixtures/gh')
const directory = [dir, fallback].find(
  (path) => existsSync(path) && readdirSync(path).some((file) => file.endsWith(`-${hash}.json`))
)
const name = directory && readdirSync(directory).find((file) => file.endsWith(`-${hash}.json`))
// PR list searches cover a rolling date window, so no recording stays valid. The lab's user has
// no PRs to list, so an unrecorded search answers empty instead of failing.
const query = args.find((arg) => arg.startsWith('query=')) ?? ''
if (!name && query.includes('search(')) {
  const data: Record<string, unknown> = {
    rateLimit: {
      cost: 1,
      remaining: 4999,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  }
  for (const [, alias, field] of query.matchAll(/(\w+): (search|nodes)\(/g))
    data[alias!] = field === 'search' ? { issueCount: 0, nodes: [] } : []
  await emit({
    code: 0,
    stdout: `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ data })}`,
    stderr: '',
  })
}
if (!name) {
  if (process.env.PERF_GH_MISSES)
    appendFileSync(process.env.PERF_GH_MISSES, `${JSON.stringify({ args, hash })}\n`)
  await emit({
    code: 1,
    stdout: '',
    stderr: `perf gh: no recorded response for ${slug} (${hash})\n`,
  })
}
await emit(await Bun.file(join(directory!, name!)).json())
