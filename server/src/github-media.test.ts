import { githubMediaPath, githubMediaPull } from '@jetty/shared/github-media'
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
    '[github-media] 404 unknown private-user-images.githubusercontent.com/1/666209191-file.png'
  )
})

const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const pull = 'acme/app/42'
const signed = `https://private-user-images.githubusercontent.com/9/${asset}.png?jwt=signed&amp;extra=1`

function stubToken() {
  spyOn(Bun, 'which').mockReturnValue('/usr/local/bin/gh')
  spyOn(Bun, 'spawn').mockImplementation((() => ({
    stdout: new Response('ghp_test\n').body,
    exited: Promise.resolve(0),
  })) as never)
}

type Seen = { url: string; authorization: string | null; accept: string | null }

function stubFetch(bodyHtml: string, reviewHtml?: string) {
  const seen: Seen[] = []
  spyOn(globalThis, 'fetch').mockImplementation((async (
    input: string | URL,
    init?: RequestInit
  ) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    seen.push({
      url,
      authorization: headers.get('authorization'),
      accept: headers.get('accept'),
    })
    const host = new URL(url).hostname
    if (host === 'github.com')
      return new Response('<html><title>Sign in to Acme</title></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    if (host === 'api.github.com') {
      if (url.includes('/issues/42/comments')) return Response.json([])
      if (url.includes('/pulls/42/comments'))
        return Response.json([{ body_html: reviewHtml ?? '' }])
      if (url.includes('/pulls/42/reviews')) return Response.json([{ body_html: 'unread' }])
      return Response.json({ body_html: bodyHtml })
    }
    if (host === 'private-user-images.githubusercontent.com')
      return new Response(null, {
        status: 302,
        headers: {
          location:
            'https://github-production-user-asset-abc.s3.amazonaws.com/obj?X-Amz-Signature=secret',
        },
      })
    if (host.endsWith('.s3.amazonaws.com'))
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    return new Response('no', { status: 500 })
  }) as typeof fetch)
  return seen
}

function cdnUntouched(seen: Seen[]) {
  for (const call of seen) {
    const host = new URL(call.url).hostname
    if (host === 'github.com' || host === 'api.github.com') continue
    expect(call.authorization).toBeNull()
    expect(call.url).not.toContain('ghp_test')
  }
}

const expired = `https://private-user-images.githubusercontent.com/142007881/666209191-${asset}.png?jwt=dead`

test('an sso sign-in page is replaced by the pull request image, without sending the token to the cdn', async () => {
  stubToken()
  expect(await ghToken({ fresh: true })).toBe('ghp_test')
  const warns: string[] = []
  spyOn(console, 'warn').mockImplementation((message: unknown) => {
    warns.push(String(message))
  })
  const seen = stubFetch(`<img src="${signed}">`)
  const media = createGithubMedia(mkdtempSync(join(tmpdir(), 'jetty-github-media-')))
  const result = await media.resolve(expired, pull)

  expect(result).not.toBeInstanceOf(GithubMediaError)
  expect(seen.map((call) => call.url.split('?')[0])).toEqual([
    `https://github.com/user-attachments/assets/${asset}`,
    'https://api.github.com/repos/acme/app/issues/42',
    `https://private-user-images.githubusercontent.com/9/${asset}.png`,
    'https://github-production-user-asset-abc.s3.amazonaws.com/obj',
  ])
  expect(seen[0]?.authorization).toBe('token ghp_test')
  expect(seen[1]?.authorization).toBe('Bearer ghp_test')
  expect(seen[1]?.accept).toBe('application/vnd.github.full+json')
  expect(seen[2]?.url).toContain('extra=1')
  expect(seen[2]?.url).not.toContain('amp')
  cdnUntouched(seen)
  expect(seen.some((call) => call.url.includes('/comments') || call.url.includes('/reviews'))).toBe(
    false
  )
  expect(warns).toContain(
    `[github-media] 200 text/html github.com/user-attachments/assets/${asset}`
  )
  expect(warns).toContain(`[github-media] fallback acme/app/42 ${asset} found`)
  expect(warns.join('\n')).not.toContain('jwt')
  expect(warns.join('\n')).not.toContain('X-Amz')

  seen.length = 0
  const again = await media.resolve(expired, pull)
  expect(again).not.toBeInstanceOf(GithubMediaError)
  expect(seen).toEqual([])
})

test('a signed image in a review comment is found after the description misses it', async () => {
  stubToken()
  expect(await ghToken({ fresh: true })).toBe('ghp_test')
  const seen = stubFetch('<p>no image</p>', `<img src="${signed}">`)
  const media = createGithubMedia(mkdtempSync(join(tmpdir(), 'jetty-github-media-')))
  const result = await media.resolve(expired, pull)

  expect(result).not.toBeInstanceOf(GithubMediaError)
  expect(seen.map((call) => call.url.split('?')[0])).toEqual([
    `https://github.com/user-attachments/assets/${asset}`,
    'https://api.github.com/repos/acme/app/issues/42',
    'https://api.github.com/repos/acme/app/issues/42/comments',
    'https://api.github.com/repos/acme/app/pulls/42/comments',
    `https://private-user-images.githubusercontent.com/9/${asset}.png`,
    'https://github-production-user-asset-abc.s3.amazonaws.com/obj',
  ])
  cdnUntouched(seen)
  expect(seen.some((call) => call.url.includes('/reviews'))).toBe(false)
})

test('a pull request context that is not owner/repo/number is ignored', async () => {
  stubToken()
  expect(await ghToken({ fresh: true })).toBe('ghp_test')
  const seen = stubFetch(`<img src="${signed}">`)
  const media = createGithubMedia(mkdtempSync(join(tmpdir(), 'jetty-github-media-')))
  const result = await media.resolve(expired, 'acme/app/../42')

  expect(result).toBeInstanceOf(GithubMediaError)
  expect((result as GithubMediaError).status).toBe(415)
  expect(seen.map((call) => new URL(call.url).hostname)).toEqual(['github.com'])
  const source = new URL(`https://github.com/user-attachments/assets/${asset}`)
  expect(githubMediaPath(source)).toBe(`/github-media?url=${encodeURIComponent(source.href)}`)
  expect(githubMediaPath(source, pull)).toBe(
    `/github-media?url=${encodeURIComponent(source.href)}&pr=acme%2Fapp%2F42`
  )
  expect(githubMediaPath(source, 'acme/app/0')).toBe(githubMediaPath(source))
  expect(githubMediaPull('a/../1')).toBeNull()
  expect(githubMediaPull('a/b/01')).toBeNull()
  expect(githubMediaPull('a/b/c/1')).toBeNull()
})
