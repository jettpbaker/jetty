import type { ThreadEvent } from '@jetty/shared/events'

import { BunServices } from '@effect/platform-bun'
import { MAX_GALLERY_IMAGES } from '@jetty/shared/items'
import { afterEach, describe, expect, test } from 'bun:test'
import { Deferred, Effect, Exit, Scope } from 'effect'
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
const scopes: Scope.Closeable[] = []

async function makeTool(host: MediaToolHost) {
  const scope = Effect.runSync(Scope.make())
  scopes.push(scope)
  return Effect.runPromise(
    createSendImagesTool(host).pipe(
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

describe('send_images', () => {
  test('two relative paths + caption emit a gallery and copy files', async () => {
    const home = tmp('jetty-send-home-')
    const project = tmp('jetty-send-proj-')
    writeFileSync(join(project, 'shot-a.png'), TINY_PNG_BYTES)
    writeFileSync(join(project, 'shot-b.png'), TINY_PNG_BYTES)

    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ paths: ['shot-a.png', 'shot-b.png'], caption: '  verification shots  ' }, {})

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

    const { host, events } = await makeHost(home, project)
    const result = await (await makeTool(host)).handler({ paths: [abs], caption: undefined }, {})

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
    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ paths: ['nope.png'], caption: undefined }, {})

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
    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ paths: ['notes.txt'], caption: undefined }, {})

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/png|jpg|gif|webp/)
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('one good + one bad path rolls back the good copy', async () => {
    const home = tmp('jetty-send-rb-home-')
    const project = tmp('jetty-send-rb-proj-')
    writeFileSync(join(project, 'shot-a.png'), TINY_PNG_BYTES)
    const { host, events } = await makeHost(home, project)
    const result = await (
      await makeTool(host)
    ).handler({ paths: ['shot-a.png', 'nope.png'], caption: undefined }, {})

    expect(result.isError).toBe(true)
    expect(events).toEqual([])
    expect(readdirSync(join(home, 'attachments'))).toEqual([])
  })

  test('input schema rejects 0 and 5 paths', async () => {
    const home = tmp('jetty-send-schema-home-')
    const project = tmp('jetty-send-schema-proj-')
    const { host } = await makeHost(home, project)
    const schema = z.object((await makeTool(host)).inputSchema)

    expect(schema.safeParse({ paths: [] }).success).toBe(false)
    expect(schema.safeParse({ paths: ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'] }).success).toBe(
      false
    )
    expect(schema.safeParse({ paths: ['a.png'] }).success).toBe(true)
    expect(MAX_GALLERY_IMAGES).toBe(4)
  })

  test('a turn change during a copy prevents stale emission and removes copied images', async () => {
    const home = tmp('jetty-send-stale-home-')
    const project = tmp('jetty-send-stale-proj-')
    writeFileSync(join(project, 'shot.png'), TINY_PNG_BYTES)
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
    ).handler({ paths: ['shot.png'], caption: undefined }, {})
    expect(result.isError).toBe(true)
    expect(events).toEqual([])
    expect(readdirSync(host.attachments.dir)).toEqual([])
  })

  test('emissions retain the captured turn and await publication in order', async () => {
    const home = tmp('jetty-send-order-home-')
    const project = tmp('jetty-send-order-proj-')
    writeFileSync(join(project, 'shot.png'), TINY_PNG_BYTES)
    const { host, events } = await makeHost(home, project)
    const started = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    const turns: string[] = []
    host.emit = (event, turnId, onCommit) =>
      Effect.gen(function* () {
        if (event.type === 'item.started') {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
        }
        events.push(event)
        yield* onCommit
        turns.push(turnId)
      })
    const pending = (await makeTool(host)).handler({ paths: ['shot.png'], caption: undefined }, {})
    await Effect.runPromise(Deferred.await(started))
    expect(events).toEqual([])
    await Effect.runPromise(Deferred.succeed(release, undefined))
    expect((await pending).isError).toBeFalsy()
    expect(events.map((event) => event.type)).toEqual(['item.started', 'item.completed'])
    expect(turns).toEqual(['turn-1', 'turn-1'])
  })

  test('closing the session scope cancels in-flight handlers and rolls back completed copies', async () => {
    const home = tmp('jetty-send-close-home-')
    const project = tmp('jetty-send-close-proj-')
    writeFileSync(join(project, 'shot.png'), TINY_PNG_BYTES)
    const { host, events } = await makeHost(home, project)
    const blocked = Effect.runSync(Deferred.make<void>())
    const persistFile = host.attachments.persistFile
    host.attachments.persistFile = (path, kind) =>
      path.endsWith('blocked.png')
        ? Deferred.succeed(blocked, undefined).pipe(Effect.andThen(Effect.never))
        : persistFile(path, kind)
    const pending = (await makeTool(host))
      .handler({ paths: ['shot.png', 'blocked.png'], caption: undefined }, {})
      .then(
        () => 'completed',
        () => 'interrupted'
      )
    await Effect.runPromise(Deferred.await(blocked))
    await Effect.runPromise(Scope.close(scopes.at(-1)!, Exit.void))
    expect(await pending).toBe('interrupted')
    expect(events).toEqual([])
    expect(readdirSync(host.attachments.dir)).toEqual([])
  })

  test('publication failures return an error and remove unreferenced copies', async () => {
    const home = tmp('jetty-send-failed-publish-home-')
    const project = tmp('jetty-send-failed-publish-proj-')
    writeFileSync(join(project, 'shot.png'), TINY_PNG_BYTES)
    const { host } = await makeHost(home, project)
    host.emit = () => Effect.fail(new Error('publication failed'))
    const result = await (
      await makeTool(host)
    ).handler({ paths: ['shot.png'], caption: undefined }, {})
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'publication failed' }])
    expect(readdirSync(host.attachments.dir)).toEqual([])
  })

  test('abort during an uninterruptible durable write retains the committed gallery images', async () => {
    const home = tmp('jetty-send-commit-abort-home-')
    const project = tmp('jetty-send-commit-abort-proj-')
    writeFileSync(join(project, 'shot.png'), TINY_PNG_BYTES)
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
      .handler({ paths: ['shot.png'], caption: undefined }, { signal: controller.signal })
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
    if (event.type !== 'item.started' || event.item.kind !== 'image_gallery')
      throw new Error('Missing committed gallery')
    expect(readdirSync(host.attachments.dir)).toEqual(
      event.item.images.map((image) => `${image.id}.png`)
    )
    expect(
      await Effect.runPromise(host.attachments.resolve(event.item.images[0]!.id))
    ).not.toBeNull()
  })

  test('a publication failure after durable commit retains gallery image references', async () => {
    const home = tmp('jetty-send-after-commit-home-')
    const project = tmp('jetty-send-after-commit-proj-')
    writeFileSync(join(project, 'shot.png'), TINY_PNG_BYTES)
    const { host, events } = await makeHost(home, project)
    host.emit = (event, _turnId, onCommit) =>
      Effect.gen(function* () {
        events.push(event)
        yield* onCommit
        return yield* Effect.fail(new Error('publication after commit failed'))
      }).pipe(Effect.uninterruptible)
    const result = await (
      await makeTool(host)
    ).handler({ paths: ['shot.png'], caption: undefined }, {})
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'publication after commit failed' }])
    const event = events[0]!
    if (event.type !== 'item.started' || event.item.kind !== 'image_gallery')
      throw new Error('Missing committed gallery')
    expect(readdirSync(host.attachments.dir)).toEqual(
      event.item.images.map((image) => `${image.id}.png`)
    )
  })
})
