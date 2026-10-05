// The lab's fake api.github.com, where JETTY_GITHUB_API_URL sends the server's API calls.
// Each request goes to the fake gh as the `gh api` call the server used to make for it, so
// the server's calls replay (or record) the same fixtures as gh's.
import { join } from 'node:path'

const strip = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection'])

// The fixtures' key: what the server once passed gh for this request.
function ghCall(method: string, path: string, body: string, etag: string | null) {
  const api = ['api', '--hostname', 'github.com', '--include']
  if (method === 'GET')
    return { args: [...api, path, ...(etag ? ['-H', `If-None-Match: ${etag}`] : [])], stdin: '' }
  const { query, variables = {} } = JSON.parse(body) as {
    query?: string
    variables?: Record<string, unknown>
  }
  if (path === 'graphql' && Object.values(variables).every((value) => typeof value === 'string'))
    return {
      args: [
        ...api,
        'graphql',
        '-f',
        `query=${query}`,
        ...Object.entries(variables).flatMap(([key, value]) => ['-f', `${key}=${value}`]),
      ],
      stdin: '',
    }
  return {
    args: [...api, ...(path === 'graphql' ? [] : ['--method', method]), path, '--input', '-'],
    stdin: body,
  }
}

// gh --include output: a status line and headers, a blank line, then the body.
function response(out: string, err: string) {
  const split = out.search(/\r?\n\r?\n/)
  const status = Number(out.match(/^HTTP\/\S+\s+(\d+)/)?.[1])
  if (split < 0 || !status) return new Response(err, { status: 502 })
  const headers = new Headers()
  for (const line of out.slice(0, split).split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':')
    const name = line.slice(0, colon).trim()
    if (colon > 0 && !strip.has(name.toLowerCase()))
      headers.append(name, line.slice(colon + 1).trim())
  }
  const body = out.slice(split).trim()
  return new Response(status === 304 ? null : body, { status, headers })
}

export function startFakeGithub(env: Record<string, string | undefined>) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const { args, stdin } = ghCall(
        request.method,
        `${url.pathname.slice(1)}${url.search}`,
        request.method === 'GET' ? '' : await request.text(),
        request.headers.get('if-none-match')
      )
      const child = Bun.spawn(['bun', join(import.meta.dir, 'gh.ts'), ...args], {
        env,
        stdin: stdin ? new Blob([stdin]) : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [out, err] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return response(out, err)
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}
