import type { ThreadEvent } from '@jetty/shared/events'

import { MAX_VIDEO_BYTES } from '@jetty/shared/wire'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MediaToolHost } from './media-host'

import { createAttachments } from './attachments'
import { createSendVideoTool } from './send-video'

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const TINY_PNG_BYTES = Buffer.from(TINY_PNG_B64, 'base64')
const FAKE_MP4 = Buffer.alloc(64, 0x01)
const FAKE_WEBM = Buffer.alloc(64, 0x02)

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

describe('send_video', () => {
  test('relative path + caption emit a video item and copy the file', async () => {
    const home = tmp('jetty-sv-home-')
    const project = tmp('jetty-sv-proj-')
    writeFileSync(join(project, 'clip.mp4'), FAKE_MP4)

    const { host, events } = makeHost(home, project)
    const result = await createSendVideoTool(host).handler(
      { path: 'clip.mp4', caption: '  verification take  ' },
      {}
    )

    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: 'Sent video to the chat: clip.mp4' }])
    expect(events).toHaveLength(2)
    const started = events[0]
    if (!started || started.type !== 'item.started' || started.item.kind !== 'video') {
      throw new Error('expected video item.started')
    }
    expect(started.item.caption).toBe('verification take')
    expect(started.item.video.name).toBe('clip.mp4')
    expect(started.item.video.mimeType).toBe('video/mp4')
    expect(started.item.video.sizeBytes).toBe(FAKE_MP4.byteLength)
    expect(existsSync(join(home, 'attachments', `${started.item.video.id}.mp4`))).toBe(true)
    expect(events[1]).toEqual({ type: 'item.completed', itemId: started.item.id })
  })

  test('.webm works with video/webm', async () => {
    const home = tmp('jetty-sv-webm-home-')
    const project = tmp('jetty-sv-webm-proj-')
    writeFileSync(join(project, 'clip.webm'), FAKE_WEBM)

    const { host, events } = makeHost(home, project)
    const result = await createSendVideoTool(host).handler(
      { path: 'clip.webm', caption: undefined },
      {}
    )

    expect(result.isError).toBeFalsy()
    const started = events[0]
    if (!started || started.type !== 'item.started' || started.item.kind !== 'video') {
      throw new Error('expected video item.started')
    }
    expect(started.item.video.name).toBe('clip.webm')
    expect(started.item.video.mimeType).toBe('video/webm')
    expect(started.item.caption).toBeUndefined()
    expect(existsSync(join(home, 'attachments', `${started.item.video.id}.webm`))).toBe(true)
  })

  test('missing file is an error with no events', async () => {
    const home = tmp('jetty-sv-miss-home-')
    const project = tmp('jetty-sv-miss-proj-')
    const { host, events } = makeHost(home, project)
    const result = await createSendVideoTool(host).handler(
      { path: 'nope.mp4', caption: undefined },
      {}
    )

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(join(project, 'nope.mp4'))
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('.png is rejected mentioning mp4, webm and not copied', async () => {
    const home = tmp('jetty-sv-png-home-')
    const project = tmp('jetty-sv-png-proj-')
    writeFileSync(join(project, 'shot.png'), TINY_PNG_BYTES)
    const { host, events } = makeHost(home, project)
    const result = await createSendVideoTool(host).handler(
      { path: 'shot.png', caption: undefined },
      {}
    )

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('mp4, webm')
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('sparse file over MAX_VIDEO_BYTES is an error', async () => {
    const home = tmp('jetty-sv-big-home-')
    const project = tmp('jetty-sv-big-proj-')
    const huge = join(project, 'huge.mp4')
    writeFileSync(huge, Buffer.alloc(0))
    truncateSync(huge, MAX_VIDEO_BYTES + 1)

    const { host, events } = makeHost(home, project)
    const result = await createSendVideoTool(host).handler(
      { path: 'huge.mp4', caption: undefined },
      {}
    )

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(String(MAX_VIDEO_BYTES))
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })
})
