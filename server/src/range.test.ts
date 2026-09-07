import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rangeResponse } from './range'

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function tempFile(bytes: Uint8Array): Bun.BunFile {
  const dir = mkdtempSync(join(tmpdir(), 'jetty-range-'))
  dirs.push(dir)
  const path = join(dir, 'clip.mp4')
  writeFileSync(path, bytes)
  return Bun.file(path)
}

describe('rangeResponse', () => {
  const body = Buffer.from('0123456789abcdefghij')

  test('no Range header returns the full file with Accept-Ranges', async () => {
    const file = tempFile(body)
    const res = rangeResponse(file, 'video/mp4', null)
    expect(res.status).toBe(200)
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(res.headers.get('Content-Length')).toBe(String(body.byteLength))
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true)
  })

  test('bytes=10-19 returns 206 with the requested slice', async () => {
    const file = tempFile(body)
    const res = rangeResponse(file, 'video/mp4', 'bytes=10-19')
    expect(res.status).toBe(206)
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Range')).toBe(`bytes 10-19/${body.byteLength}`)
    expect(res.headers.get('Content-Length')).toBe('10')
    expect(Buffer.from(await res.arrayBuffer()).equals(body.subarray(10, 20))).toBe(true)
  })

  test('bytes=10- (open end) slices through EOF', async () => {
    const file = tempFile(body)
    const res = rangeResponse(file, 'video/mp4', 'bytes=10-')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 10-19/${body.byteLength}`)
    expect(Buffer.from(await res.arrayBuffer()).equals(body.subarray(10))).toBe(true)
  })

  test('suffix form is treated as unsupported and returns the full file', async () => {
    const file = tempFile(body)
    const res = rangeResponse(file, 'video/mp4', 'bytes=-5')
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true)
  })

  test('unsatisfiable range returns 416', async () => {
    const file = tempFile(body)
    const res = rangeResponse(file, 'video/mp4', 'bytes=9999-')
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe(`bytes */${body.byteLength}`)
  })
})
