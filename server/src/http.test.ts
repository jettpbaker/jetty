import { newId } from '@jetty/shared/wire'
import { afterEach, expect, test } from 'bun:test'
import { Effect, Schedule } from 'effect'
import {
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startServer } from './main'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'jetty-http-'))
  const server = await startServer({ home, port: 0, agent: 'echo' })
  cleanup.push(async () => {
    await server.stop()
    rmSync(home, { recursive: true, force: true })
  })
  return { server, home, url: `http://127.0.0.1:${server.port}` }
}

function openFiles(path: string) {
  return readdirSync('/proc/self/fd').filter((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`) === path
    } catch {
      return false
    }
  }).length
}

async function closed(path: string) {
  await Effect.runPromise(
    Effect.sync(() => openFiles(path)).pipe(
      Effect.repeat({ until: (count) => count === 0, schedule: Schedule.spaced(1) }),
      Effect.timeout('2 seconds')
    )
  )
}

test('native HTTP rejects non-loopback websocket origins and preserves no-upgrade errors', async () => {
  const f = await fixture()
  for (const origin of [
    'https://evil.example',
    'null',
    'http://localhost.evil.example',
    'garbage',
  ]) {
    expect((await fetch(`${f.url}/ws`, { headers: { origin } })).status).toBe(403)
  }
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
    expect((await fetch(`${f.url}/ws`, { headers: { origin } })).status).toBe(400)
  }
  expect((await fetch(`${f.url}/ws`)).status).toBe(400)
})

test('native attachment HTTP preserves binary ranges and refuses traversal and escaping symlinks', async () => {
  const f = await fixture()
  const id = newId()
  const bytes = Buffer.from('0123456789abcdefghij')
  const path = join(f.home, 'attachments', `${id}.mp4`)
  writeFileSync(path, bytes)
  const full = await fetch(`${f.url}/attachments/${id}`)
  expect(full.status).toBe(200)
  expect(full.headers.get('content-type')).toBe('video/mp4')
  expect(full.headers.get('content-length')).toBe('20')
  expect(full.headers.get('accept-ranges')).toBe('bytes')
  expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes)
  for (const [range, expected] of [
    ['bytes=10-19', 'abcdefghij'],
    ['bytes=10-', 'abcdefghij'],
    ['bytes=18-99', 'ij'],
    ['bytes=-5', 'fghij'],
  ] as const) {
    const response = await fetch(`${f.url}/attachments/${id}`, { headers: { Range: range } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-length')).toBe(String(expected.length))
    if (range === 'bytes=-5') {
      expect(response.headers.get('content-range')).toBe('bytes 15-19/20')
    }
    expect(await response.text()).toBe(expected)
  }
  for (const range of ['bytes=0-1,4-5', 'items=0-2', 'invalid']) {
    const response = await fetch(`${f.url}/attachments/${id}`, { headers: { Range: range } })
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
  }
  for (const range of ['bytes=20-', 'bytes=8-7']) {
    const response = await fetch(`${f.url}/attachments/${id}`, { headers: { Range: range } })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */20')
    expect(await response.text()).toBe('')
  }
  const emptyId = newId()
  writeFileSync(join(f.home, 'attachments', `${emptyId}.mp4`), '')
  expect(
    (await fetch(`${f.url}/attachments/${emptyId}`, { headers: { Range: 'bytes=0-' } })).status
  ).toBe(416)
  const outside = join(f.home, 'outside.mp4')
  writeFileSync(outside, bytes)
  const escape = newId()
  symlinkSync(outside, join(f.home, 'attachments', `${escape}.mp4`))
  for (const name of [
    '',
    'not-an-id',
    `${id}/nested`,
    '%2e%2e%2foutside.mp4',
    `${id}%5cevil`,
    escape,
  ]) {
    expect((await fetch(`${f.url}/attachments/${name}`)).status).toBe(404)
  }
})

test('native file streaming closes its descriptor when the request is cancelled', async () => {
  const f = await fixture()
  const id = newId()
  const path = join(f.home, 'attachments', `${id}.mp4`)
  writeFileSync(path, '')
  truncateSync(path, 64 * 1024 * 1024)
  const controller = new AbortController()
  const response = await fetch(`${f.url}/attachments/${id}`, { signal: controller.signal })
  const reader = response.body!.getReader()
  expect((await reader.read()).done).toBe(false)
  expect(openFiles(path)).toBeGreaterThan(0)
  controller.abort()
  await reader.cancel().catch(() => undefined)
  await closed(path)
  expect(openFiles(path)).toBe(0)
})

test('native listener shutdown closes an active file stream before finishing', async () => {
  const f = await fixture()
  const id = newId()
  const path = join(f.home, 'attachments', `${id}.mp4`)
  writeFileSync(path, '')
  truncateSync(path, 64 * 1024 * 1024)
  const response = await fetch(`${f.url}/attachments/${id}`)
  const reader = response.body!.getReader()
  expect((await reader.read()).done).toBe(false)
  expect(openFiles(path)).toBeGreaterThan(0)
  await f.server.stop()
  expect(openFiles(path)).toBe(0)
  await reader.cancel().catch(() => undefined)
})
