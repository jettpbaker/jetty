import type { Attachment } from '@jetty/shared/items'

import { BunServices } from '@effect/platform-bun'
import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Effect, FileSystem } from 'effect'

import { createAttachments } from './attachments'
import { createMediaSender } from './media-host'

for (const kind of ['image', 'video'] as const) {
  for (const redirect of ['alias', 'resolved'] as const) {
    test(`${kind} copies the verified file when its ${redirect} path redirects to another attachment`, async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            const home = yield* fs.makeTempDirectoryScoped()
            const attachments = yield* createAttachments(home)
            const ext = kind === 'image' ? 'png' : 'mp4'
            const original = `${home}/original.${ext}`
            const alias = `${home}/alias.${ext}`
            const foreign = `${attachments.dir}/${newId()}.${ext}`
            yield* fs.writeFileString(original, 'original media')
            yield* fs.writeFileString(foreign, 'foreign media')
            yield* fs.symlink(original, alias)
            const persistFile = attachments.persistFile
            attachments.persistFile = (source, kind, file) =>
              Effect.gen(function* () {
                if (redirect === 'alias') yield* fs.remove(alias)
                else yield* fs.rename(original, original + '.moved')
                yield* fs.symlink(foreign, redirect === 'alias' ? alias : original)
                return yield* persistFile(source, kind, file)
              })
            let posted: readonly Attachment[] = []
            const send = yield* createMediaSender({
              attachments,
              projectPath: home,
              turnId: () => 'turn',
              resolveAttachment: () => Effect.fail(new Error('Foreign attachment refused')),
              emit: (event, _turnId, onCommit) =>
                Effect.sync(() => {
                  if (event.type === 'item.started' && event.item.kind === 'image_gallery')
                    posted = event.item.images
                  if (event.type === 'item.started' && event.item.kind === 'video')
                    posted = [event.item.video]
                }).pipe(Effect.andThen(onCommit)),
            })
            const result = yield* Effect.promise(() =>
              send(
                {
                  kind,
                  paths: [alias],
                  caption: undefined,
                  toItem: (media) =>
                    kind === 'image'
                      ? { kind: 'image_gallery', images: media }
                      : { kind: 'video', video: media[0]! },
                  summary: () => 'sent',
                },
                {}
              )
            )
            expect(result.isError).toBeFalsy()
            expect(posted).toHaveLength(1)
            expect(posted[0]!.name).toBe(`alias.${ext}`)
            const saved = yield* attachments.resolve(posted[0]!.id)
            expect(yield* fs.readFileString(saved!.path)).toBe('original media')
            expect(yield* fs.readFileString(foreign)).toBe('foreign media')
            expect(yield* fs.readDirectory(attachments.dir)).toHaveLength(2)
          })
        ).pipe(Effect.provide(BunServices.layer))
      )
    })
  }
}
