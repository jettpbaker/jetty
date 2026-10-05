import { afterEach, expect, mock, spyOn, test } from 'bun:test'

import { uploadGithubAttachment } from './github-upload'
import { ghToken, restGet } from './pull-requests'

afterEach(() => mock.restore())

test('a GitHub write after `gh auth switch` goes out as the account switched to', async () => {
  let account = 'first'
  spyOn(Bun, 'which').mockReturnValue('/usr/local/bin/gh')
  spyOn(Bun, 'spawn').mockImplementation((() => ({
    stdout: new Response(`${account}-token\n`).body,
    exited: Promise.resolve(0),
  })) as never)
  const sent: string[] = []
  spyOn(globalThis, 'fetch').mockImplementation((async (
    input: string | URL,
    init?: RequestInit
  ) => {
    const { hostname } = new URL(String(input))
    sent.push(`${hostname} ${new Headers(init?.headers).get('authorization')}`)
    return Response.json(
      hostname === 'uploads.github.com'
        ? { url: 'https://github.com/user-attachments/assets/a1' }
        : { id: 1, permissions: { push: true } }
    )
  }) as typeof fetch)

  expect(await ghToken({ fresh: true })).toBe('first-token')
  await restGet('repos/jetty/app')
  account = 'second'
  await uploadGithubAttachment({
    repo: 'jetty/app',
    name: 'shot.png',
    mimeType: 'image/png',
    base64data: 'aW1hZ2U=',
  })

  expect(sent).toEqual([
    'api.github.com Bearer first-token',
    'api.github.com Bearer second-token',
    'uploads.github.com Bearer second-token',
  ])
  expect(await ghToken()).toBe('second-token')
})
