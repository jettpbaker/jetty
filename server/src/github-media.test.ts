import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createGithubMedia, GithubMediaError } from './github-media'
import { ghToken } from './pull-requests'

const asset = '01cffe26-f55c-4701-9cd0-8dc8b49940a7'

afterEach(() => mock.restore())

test('a private attachment is fetched from its stable url, and a 404 is logged', async () => {
  spyOn(Bun, 'which').mockReturnValue('/usr/local/bin/gh')
  spyOn(Bun, 'spawn').mockImplementation((() => ({
    stdout: new Response('ghp_test\n').body,
    exited: Promise.resolve(0),
  })) as never)
  expect(await ghToken({ fresh: true })).toBe('ghp_test')

  const seen: { url: string; authorization: string | null }[] = []
  const warns: string[] = []
  spyOn(console, 'warn').mockImplementation((message: unknown) => {
    warns.push(String(message))
  })
  spyOn(globalThis, 'fetch').mockImplementation((async (
    input: string | URL,
    init?: RequestInit
  ) => {
    const url = String(input)
    seen.push({ url, authorization: new Headers(init?.headers).get('authorization') })
    if (url.startsWith('https://github.com/'))
      return new Response(null, {
        status: 302,
        headers: {
          location:
            'https://private-user-images.githubusercontent.com/1/666209191-file.png?jwt=fresh',
        },
      })
    return new Response('missing', { status: 404 })
  }) as typeof fetch)

  const media = createGithubMedia(mkdtempSync(join(tmpdir(), 'jetty-github-media-')))
  const result = await media.resolve(
    `https://private-user-images.githubusercontent.com/142007881/666209191-${asset}.png?jwt=dead`
  )

  expect(result).toBeInstanceOf(GithubMediaError)
  expect((result as GithubMediaError).status).toBe(404)
  expect(seen.map((call) => call.url.split('?')[0])).toEqual([
    `https://github.com/user-attachments/assets/${asset}`,
    'https://private-user-images.githubusercontent.com/1/666209191-file.png',
  ])
  expect(seen[0]?.authorization).toBe('token ghp_test')
  expect(seen[1]?.authorization).toBeNull()
  expect(warns).toContain(
    '[github-media] 404 private-user-images.githubusercontent.com/1/666209191-file.png'
  )
})
