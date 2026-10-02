// Fake `gh` (run through perf/bin/gh on the lab server's PATH). Replays recorded responses
// keyed by normalised arguments and stdin; in record mode it runs the real gh once and saves
// what it said. A replay miss fails like an unreachable API and is logged for the lab.
import { appendFileSync, mkdirSync, readdirSync } from 'node:fs'
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
  .join('-')
  .replace(/query=.*/, 'graphql')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .slice(0, 60)
  .replace(/^-|-$/g, '')

function redact(text: string) {
  return text.replace(/\bgh[opsur]_[A-Za-z0-9_]+/g, 'gh*_REDACTED')
}

function emit(fixture: Pick<Fixture, 'code' | 'stdout' | 'stderr'>): never {
  process.stdout.write(fixture.stdout)
  process.stderr.write(fixture.stderr)
  process.exit(fixture.code)
}

if (mode === 'record') {
  const real = process.env.PERF_GH_REAL
  if (!real) emit({ code: 1, stdout: '', stderr: 'perf gh: no real gh to record from\n' })
  const child = Bun.spawn([real, ...Bun.argv.slice(2)], {
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
  emit({ code, stdout, stderr })
}

const name = readdirSync(dir).find((file) => file.endsWith(`-${hash}.json`))
if (!name) {
  if (process.env.PERF_GH_MISSES)
    appendFileSync(process.env.PERF_GH_MISSES, `${JSON.stringify({ args, hash })}\n`)
  emit({ code: 1, stdout: '', stderr: `perf gh: no recorded response for ${slug} (${hash})\n` })
}
emit(await Bun.file(join(dir, name)).json())
