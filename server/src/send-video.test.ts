import type { ThreadEvent } from '@jetty/shared/events'

import { BunServices } from '@effect/platform-bun'
import { MAX_VIDEO_BYTES } from '@jetty/shared/wire'
import { afterEach, describe, expect, test } from 'bun:test'
import { Deferred, Effect, Exit, Scope } from 'effect'
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
const scopes: Scope.Closeable[] = []

async function makeTool(host: MediaToolHost) {
  const scope = Effect.runSync(Scope.make())
  scopes.push(scope)
  return Effect.runPromise(
    createSendVideoTool(host).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provide(BunServices.layer)
    )
  )
}

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void))
  while (dirs.length) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

async function makeHost(
  home: string,
  projectPath: string
): Promise<{ host: MediaToolHost; events: ThreadEvent[] }> {
  const events: ThreadEvent[] = []
  return {
    events,
    host: {
      attachments: await Effect.runPromise(
        createAttachments(home).pipe(Effect.provide(BunServices.layer))
      ),
      projectPath,
      turnId: () => 'turn-1',
      emit: (event, _turnId, onCommit) =>
        Effect.sync(() => {
          events.push(event)
        }).pipe(Effect.andThen(onCommit), Effect.uninterruptible),
    },
  }
}

describe('send_video', () => {
  test('relative path + caption emit a video item and copy the file', async () => {
    const home = tmp('jetty-sv-home-')
    const project = tmp('jetty-sv-proj-')
    writeFileSync(join(project, 'clip.mp4'), FAKE_MP4)

    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ path: 'clip.mp4', caption: '  verification take  ' }, {})

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

    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ path: 'clip.webm', caption: undefined }, {})

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
    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ path: 'nope.mp4', caption: undefined }, {})

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(join(project, 'nope.mp4'))
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('.png is rejected mentioning mp4, webm and not copied', async () => {
    const home = tmp('jetty-sv-png-home-')
    const project = tmp('jetty-sv-png-proj-')
    writeFileSync(join(project, 'shot.png'), TINY_PNG_BYTES)
    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ path: 'shot.png', caption: undefined }, {})

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

    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ path: 'huge.mp4', caption: undefined }, {})

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(String(MAX_VIDEO_BYTES))
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('a turn change during a copy prevents stale video emission and removes the copy', async () => {
    const home = tmp('jetty-sv-stale-home-')
    const project = tmp('jetty-sv-stale-proj-')
    writeFileSync(join(project, 'clip.mp4'), FAKE_MP4)
    const { host, events } = await makeHost(home, project)
    let turnId = 'turn-1'
    host.turnId = () => turnId
    const persistFile = host.attachments.persistFile
    host.attachments.persistFile = (path, kind) =>
      persistFile(path, kind).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            turnId = 'turn-2'
          })
        )
      )
    const result = await (
      await makeTool(host)
    ).handler({ path: 'clip.mp4', caption: undefined }, {})
    expect(result.isError).toBe(true)
    expect(events).toEqual([])
    expect(readdirSync(host.attachments.dir)).toEqual([])
  })

  test('SDK abort signals cancel blocked publication and clean unreferenced videos', async () => {
    const home = tmp('jetty-sv-cancel-home-')
    const project = tmp('jetty-sv-cancel-proj-')
    writeFileSync(join(project, 'clip.mp4'), FAKE_MP4)
    const { host, events } = await makeHost(home, project)
    const publishing = Effect.runSync(Deferred.make<void>())
    host.emit = () => Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Effect.never))
    const controller = new AbortController()
    const pending = (await makeTool(host))
      .handler({ path: 'clip.mp4', caption: undefined }, { signal: controller.signal })
      .then(
        () => 'completed',
        () => 'interrupted'
      )
    await Effect.runPromise(Deferred.await(publishing))
    controller.abort()
    expect(await pending).toBe('interrupted')
    expect(events).toEqual([])
    expect(readdirSync(host.attachments.dir)).toEqual([])
  })

  test('abort during an uninterruptible durable write retains the committed video', async () => {
    const home = tmp('jetty-sv-commit-abort-home-')
    const project = tmp('jetty-sv-commit-abort-proj-')
    writeFileSync(join(project, 'clip.mp4'), FAKE_MP4)
    const { host, events } = await makeHost(home, project)
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    host.emit = (event, _turnId, onCommit) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(release)
        events.push(event)
        yield* onCommit
      }).pipe(Effect.uninterruptible)
    const controller = new AbortController()
    const pending = (await makeTool(host))
      .handler({ path: 'clip.mp4', caption: undefined }, { signal: controller.signal })
      .then(
        () => 'completed',
        () => 'interrupted'
      )
    await Effect.runPromise(Deferred.await(entered))
    controller.abort()
    await Effect.runPromise(Deferred.succeed(release, undefined))
    expect(await pending).toBe('interrupted')
    expect(events).toHaveLength(1)
    const event = events[0]!
    if (event.type !== 'item.started' || event.item.kind !== 'video')
      throw new Error('Missing committed video')
    expect(readdirSync(host.attachments.dir)).toEqual([`${event.item.video.id}.mp4`])
    expect(await Effect.runPromise(host.attachments.resolve(event.item.video.id))).not.toBeNull()
  })

  test('a publication failure after durable commit retains the video reference', async () => {
    const home = tmp('jetty-sv-after-commit-home-')
    const project = tmp('jetty-sv-after-commit-proj-')
    writeFileSync(join(project, 'clip.mp4'), FAKE_MP4)
    const { host, events } = await makeHost(home, project)
    host.emit = (event, _turnId, onCommit) =>
      Effect.gen(function* () {
        events.push(event)
        yield* onCommit
        return yield* Effect.fail(new Error('publication after commit failed'))
      }).pipe(Effect.uninterruptible)
    const result = await (
      await makeTool(host)
    ).handler({ path: 'clip.mp4', caption: undefined }, {})
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'publication after commit failed' }])
    const event = events[0]!
    if (event.type !== 'item.started' || event.item.kind !== 'video')
      throw new Error('Missing committed video')
    expect(readdirSync(host.attachments.dir)).toEqual([`${event.item.video.id}.mp4`])
  })
})
