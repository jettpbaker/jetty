import { BunServices } from '@effect/platform-bun'
import { describe, expect, test } from 'bun:test'
import { Deferred, Effect, Exit, Fiber, FileSystem, PlatformError } from 'effect'

import { createAttachments } from './attachments'

function run<A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) {
  return Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)))
}

const upload = {
  name: 'image.png',
  mimeType: 'image/png' as const,
  dataUrl: 'data:image/png;base64,aW1hZ2U=',
}

describe('Effect attachment persistence', () => {
  test('upload persistence retains metadata and image payloads and resolves only contained IDs', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          const attachments = yield* createAttachments(root)
          const result = yield* attachments.persist([upload])
          expect(result.meta[0]).toMatchObject({
            name: 'image.png',
            mimeType: 'image/png',
            sizeBytes: 5,
          })
          expect(result.images).toEqual([{ mimeType: 'image/png', base64data: 'aW1hZ2U=' }])
          const id = result.meta[0]!.id
          const resolved = yield* attachments.resolve(id)
          expect(resolved?.mimeType).toBe('image/png')
          expect(yield* fs.readFileString(resolved!.path)).toBe('image')
          expect(yield* attachments.resolve('../escape')).toBeNull()
          expect(yield* attachments.resolve(id + '.png')).toBeNull()
          yield* attachments.remove(id)
          expect(yield* fs.readDirectory(attachments.dir)).toEqual([])
        })
      )
    )
  })

  test('invalid uploads roll back all files and staging directories', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          const attachments = yield* createAttachments(root)
          const result = yield* attachments
            .persist([upload, { ...upload, dataUrl: 'data:image/png;base64,?' }])
            .pipe(Effect.result)
          expect(result._tag).toBe('Failure')
          expect(yield* fs.readDirectory(attachments.dir)).toEqual([])
        })
      )
    )
  })

  test('rename failures roll back prior successful writes and temporary files', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          let writes = 0
          const faulty = {
            ...fs,
            rename: (from: string, to: string) =>
              ++writes === 2
                ? Effect.fail(
                    PlatformError.systemError({
                      _tag: 'PermissionDenied',
                      module: 'FileSystem',
                      method: 'rename',
                    })
                  )
                : fs.rename(from, to),
          }
          const attachments = yield* createAttachments(root).pipe(
            Effect.provideService(FileSystem.FileSystem, faulty)
          )
          const result = yield* attachments.persist([upload, upload]).pipe(Effect.result)
          expect(result._tag).toBe('Failure')
          expect(yield* fs.readDirectory(attachments.dir)).toEqual([])
        })
      )
    )
  })

  test('cancelled uploads remove prior writes and incomplete staging files', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          const copying = yield* Deferred.make<void>()
          let writes = 0
          const faulty = {
            ...fs,
            writeFile: (...args: Parameters<typeof fs.writeFile>) =>
              Effect.gen(function* () {
                yield* fs.writeFile(...args)
                if (++writes === 2) {
                  yield* Deferred.succeed(copying, undefined)
                  yield* Effect.never
                }
              }),
          }
          const attachments = yield* createAttachments(root).pipe(
            Effect.provideService(FileSystem.FileSystem, faulty)
          )
          const fiber = yield* attachments.persist([upload, upload]).pipe(Effect.forkScoped)
          yield* Deferred.await(copying)
          yield* Fiber.interrupt(fiber)
          expect(yield* fs.readDirectory(attachments.dir)).toEqual([])
        })
      )
    )
  })

  test('cancelled file copies remove incomplete staging files', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          yield* fs.writeFileString(root + '/clip.mp4', 'video')
          const copying = yield* Deferred.make<void>()
          const faulty = {
            ...fs,
            copyFile: (from: string, to: string) =>
              Effect.gen(function* () {
                yield* fs.copyFile(from, to)
                yield* Deferred.succeed(copying, undefined)
                yield* Effect.never
              }),
          }
          const attachments = yield* createAttachments(root).pipe(
            Effect.provideService(FileSystem.FileSystem, faulty)
          )
          const fiber = yield* attachments
            .persistFile(root + '/clip.mp4', 'video')
            .pipe(Effect.forkScoped)
          yield* Deferred.await(copying)
          yield* Fiber.interrupt(fiber)
          expect(yield* fs.readDirectory(attachments.dir)).toEqual([])
        })
      )
    )
  })

  test('cancellation waits for an in-flight rename before removing the finalized file', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          yield* fs.writeFileString(root + '/clip.mp4', 'video')
          const renaming = yield* Deferred.make<void>()
          const finishRename = yield* Deferred.make<void>()
          let renamed = false
          const faulty = {
            ...fs,
            rename: (from: string, to: string) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(renaming, undefined)
                yield* Deferred.await(finishRename)
                yield* fs.rename(from, to)
                renamed = true
              }),
          }
          const attachments = yield* createAttachments(root).pipe(
            Effect.provideService(FileSystem.FileSystem, faulty)
          )
          const fiber = yield* attachments
            .persistFile(root + '/clip.mp4', 'video')
            .pipe(Effect.forkScoped)
          yield* Deferred.await(renaming)
          const interrupt = yield* Fiber.interrupt(fiber).pipe(Effect.forkScoped)
          yield* Effect.yieldNow
          yield* Deferred.succeed(finishRename, undefined)
          yield* Fiber.join(interrupt)
          expect(renamed).toBe(true)
          expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true)
          expect(yield* fs.readDirectory(attachments.dir)).toEqual([])
        })
      )
    )
  })

  test('file validation rejects empty and directory inputs and normalizes jpeg extensions', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          const attachments = yield* createAttachments(root)
          yield* fs.writeFileString(root + '/empty.png', '')
          yield* fs.makeDirectory(root + '/directory.png')
          expect(
            (yield* attachments.persistFile(root + '/empty.png', 'image').pipe(Effect.result))._tag
          ).toBe('Failure')
          expect(
            (yield* attachments.persistFile(root + '/directory.png', 'image').pipe(Effect.result))
              ._tag
          ).toBe('Failure')
          yield* fs.writeFileString(root + '/photo.JPEG', 'photo')
          const image = yield* attachments.persistFile(root + '/photo.JPEG', 'image')
          expect(image).toMatchObject({ name: 'photo.JPEG', mimeType: 'image/jpeg', sizeBytes: 5 })
          expect((yield* attachments.resolve(image.id))?.path).toEndWith('.jpg')
        })
      )
    )
  })

  test('attachment resolution refuses symlinks escaping its directory', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          const attachments = yield* createAttachments(root)
          const id = '00000000-0000-0000-0000-000000000000'
          yield* fs.writeFileString(root + '/outside.png', 'private')
          yield* fs.symlink(root + '/outside.png', attachments.dir + '/' + id + '.png')
          expect(yield* attachments.resolve(id)).toBeNull()
          yield* attachments.remove(id)
          expect(yield* fs.readFileString(root + '/outside.png')).toBe('private')
        })
      )
    )
  })
})
