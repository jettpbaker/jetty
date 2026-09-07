import type { ThreadEvent } from '@jetty/shared/events'

import { MAX_GALLERY_IMAGES } from '@jetty/shared/items'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import type { MediaToolHost } from './media-host'

import { createAttachments } from './attachments'
import { createSendImagesTool } from './send-images'

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const TINY_PNG_BYTES = Buffer.from(TINY_PNG_B64, 'base64')

const dirs: string[] = []

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeHost(
  home: string,
  projectPath: string
): { host: MediaToolHost; events: ThreadEvent[] } {
  const events: ThreadEvent[] = []
  return {
    events,
    host: {
      attachments: createAttachments(home),
      projectPath,
      turnId: () => 'turn-1',
      emit: (event) => {
        events.push(event)
      },
    },
  }
}

describe('send_images', () => {
  test('two relative paths + caption emit a gallery and copy files', async () => {
    const home = tmp('jetty-send-home-')
    const project = tmp('jetty-send-proj-')
    writeFileSync(join(project, 'shot-a.png'), TINY_PNG_BYTES)
    writeFileSync(join(project, 'shot-b.png'), TINY_PNG_BYTES)

    const { host, events } = makeHost(home, project)
    const result = await createSendImagesTool(host).handler(
      { paths: ['shot-a.png', 'shot-b.png'], caption: '  verification shots  ' },
      {}
    )

    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([
      { type: 'text', text: 'Sent 2 images to the chat: shot-a.png, shot-b.png' },
    ])
    expect(events).toHaveLength(2)
    const started = events[0]
    if (!started || started.type !== 'item.started' || started.item.kind !== 'image_gallery') {
      throw new Error('expected image_gallery item.started')
    }
    expect(started.item.caption).toBe('verification shots')
    expect(started.item.images).toHaveLength(2)
    for (const img of started.item.images) {
      expect(img.mimeType).toBe('image/png')
      expect(img.sizeBytes).toBe(TINY_PNG_BYTES.byteLength)
      expect(existsSync(join(home, 'attachments', `${img.id}.png`))).toBe(true)
    }
    expect(started.item.images[0]!.name).toBe('shot-a.png')
    expect(started.item.images[1]!.name).toBe('shot-b.png')
    expect(events[1]).toEqual({ type: 'item.completed', itemId: started.item.id })
  })

  test('absolute path works', async () => {
    const home = tmp('jetty-send-abs-home-')
    const project = tmp('jetty-send-abs-proj-')
    const abs = join(project, 'shot-a.png')
    writeFileSync(abs, TINY_PNG_BYTES)

    const { host, events } = makeHost(home, project)
    const result = await createSendImagesTool(host).handler(
      { paths: [abs], caption: undefined },
      {}
    )

    expect(result.isError).toBeFalsy()
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'Sent 1 image to the chat: shot-a.png',
    })
    expect(events[0]).toMatchObject({
      type: 'item.started',
      item: { kind: 'image_gallery' },
    })
  })

  test('missing file is an error with no events and no leftover files', async () => {
    const home = tmp('jetty-send-miss-home-')
    const project = tmp('jetty-send-miss-proj-')
    const { host, events } = makeHost(home, project)
    const result = await createSendImagesTool(host).handler(
      { paths: ['nope.png'], caption: undefined },
      {}
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect((result.content[0] as { text: string }).text).toContain(join(project, 'nope.png'))
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('.txt is rejected with supported types', async () => {
    const home = tmp('jetty-send-txt-home-')
    const project = tmp('jetty-send-txt-proj-')
    writeFileSync(join(project, 'notes.txt'), 'not an image')
    const { host, events } = makeHost(home, project)
    const result = await createSendImagesTool(host).handler(
      { paths: ['notes.txt'], caption: undefined },
      {}
    )

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/png|jpg|gif|webp/)
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('one good + one bad path rolls back the good copy', async () => {
    const home = tmp('jetty-send-rb-home-')
    const project = tmp('jetty-send-rb-proj-')
    writeFileSync(join(project, 'shot-a.png'), TINY_PNG_BYTES)
    const { host, events } = makeHost(home, project)
    const result = await createSendImagesTool(host).handler(
      { paths: ['shot-a.png', 'nope.png'], caption: undefined },
      {}
    )

    expect(result.isError).toBe(true)
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('input schema rejects 0 and 5 paths', () => {
    const home = tmp('jetty-send-schema-home-')
    const project = tmp('jetty-send-schema-proj-')
    const { host } = makeHost(home, project)
    const schema = z.object(createSendImagesTool(host).inputSchema)

    expect(schema.safeParse({ paths: [] }).success).toBe(false)
    expect(schema.safeParse({ paths: ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'] }).success).toBe(
      false
    )
    expect(schema.safeParse({ paths: ['a.png'] }).success).toBe(true)
    expect(MAX_GALLERY_IMAGES).toBe(4)
  })
})
