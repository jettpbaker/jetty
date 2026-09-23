import type { Attachment } from '@jetty/shared/items'

import {
  MAX_IMAGE_BYTES,
  MAX_TURN_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  newId,
  type UploadAttachment,
} from '@jetty/shared/wire'
import { Context, Effect, FileSystem, Layer, Path } from 'effect'

import type { AgentImage } from './agent'

import { StoreError } from './store'

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
} as const

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

const KINDS = {
  image: { noun: 'Image', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp'], maxBytes: MAX_IMAGE_BYTES },
  video: { noun: 'Video', exts: ['mp4', 'webm'], maxBytes: MAX_VIDEO_BYTES },
}

export type PersistKind = keyof typeof KINDS

const ATTACHMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PersistedAttachments = {
  meta: Attachment[]
  images: AgentImage[]
}

export type Attachments = Effect.Success<ReturnType<typeof createAttachments>>
export const Attachments = Context.Service<Attachments>('jetty/Attachments')

export function AttachmentsLive(home: string) {
  return Layer.effect(Attachments, createAttachments(home))
}

export function createAttachments(home: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = path.resolve(home, 'attachments')
    yield* fs.makeDirectory(dir, { recursive: true })

    function persist(uploads: readonly UploadAttachment[] | undefined) {
      if (!uploads || uploads.length === 0) {
        return Effect.succeed({ meta: [], images: [] } satisfies PersistedAttachments)
      }

      const written: string[] = []
      const meta: Attachment[] = []
      const images: AgentImage[] = []

      return Effect.scoped(
        Effect.gen(function* () {
          const staging = yield* fs.makeTempDirectoryScoped({ directory: dir, prefix: '.upload-' })
          let totalBytes = 0
          for (const upload of uploads) {
            const { bytes, base64data } = yield* decodeDataUrl(upload)
            if (bytes.byteLength > MAX_IMAGE_BYTES) {
              return yield* Effect.fail(
                new StoreError(
                  'invalid_params',
                  `Image exceeds ${MAX_IMAGE_BYTES} bytes (got ${bytes.byteLength})`
                )
              )
            }
            totalBytes += bytes.byteLength
            if (totalBytes > MAX_TURN_IMAGE_BYTES) {
              return yield* Effect.fail(
                new StoreError(
                  'invalid_params',
                  `Images exceed ${MAX_TURN_IMAGE_BYTES} bytes in total`
                )
              )
            }

            const id = newId()
            const filename = `${id}.${MIME_EXT[upload.mimeType]}`
            const destination = path.join(dir, filename)
            yield* fs.writeFile(path.join(staging, filename), bytes)
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                written.push(destination)
                yield* fs.rename(path.join(staging, filename), destination)
              })
            )

            meta.push({
              id,
              name: upload.name,
              mimeType: upload.mimeType,
              sizeBytes: bytes.byteLength,
            })
            images.push({ mimeType: upload.mimeType, base64data })
          }
          return { meta, images }
        })
      ).pipe(
        Effect.onError(() =>
          Effect.forEach(written, (file) => fs.remove(file).pipe(Effect.ignore), { discard: true })
        )
      )
    }

    function persistFile(srcPath: string, kind: PersistKind) {
      const { noun, exts, maxBytes } = KINDS[kind]
      const invalid = (message: string) => Effect.fail(new StoreError('invalid_params', message))

      function checkSize(size: bigint) {
        if (size === 0n) return invalid(`${noun} is empty: ${srcPath}`)
        if (size > maxBytes) return invalid(`${noun} exceeds ${maxBytes} bytes (got ${size})`)
        return Effect.void
      }

      return Effect.scoped(
        Effect.gen(function* () {
          const stat = yield* fs
            .stat(srcPath)
            .pipe(
              Effect.mapError(
                () => new StoreError('invalid_params', `Cannot read ${kind} file: ${srcPath}`)
              )
            )
          if (stat.type !== 'File') return yield* invalid(`Not a regular file: ${srcPath}`)

          const rawExt = path.extname(srcPath).slice(1).toLowerCase()
          if (!exts.includes(rawExt)) {
            return yield* invalid(`Unsupported ${kind} type; accepted types: ${exts.join(', ')}`)
          }
          const ext = rawExt === 'jpeg' ? 'jpg' : rawExt
          yield* checkSize(stat.size)

          const id = newId()
          const dest = path.join(dir, `${id}.${ext}`)
          const staging = yield* fs.makeTempDirectoryScoped({ directory: dir, prefix: '.media-' })
          const temporary = path.join(staging, `${id}.${ext}`)
          return yield* Effect.gen(function* () {
            yield* fs.copyFile(srcPath, temporary)
            const copied = yield* fs.stat(temporary)
            yield* checkSize(copied.size)
            yield* fs.rename(temporary, dest).pipe(Effect.uninterruptible)
            return {
              id,
              name: path.basename(srcPath),
              mimeType: EXT_MIME[ext]!,
              sizeBytes: Number(copied.size),
            } satisfies Attachment
          }).pipe(
            Effect.mapError((error) =>
              error instanceof StoreError
                ? error
                : new StoreError('invalid_params', `Cannot read ${kind} file: ${srcPath}`)
            ),
            Effect.onError(() => fs.remove(dest).pipe(Effect.ignore))
          )
        })
      )
    }

    function resolve(id: string) {
      return Effect.gen(function* () {
        if (!ATTACHMENT_ID_RE.test(id)) return null

        for (const [ext, mimeType] of Object.entries(EXT_MIME)) {
          const file = path.join(dir, `${id}.${ext}`)
          const actual = yield* fs.realPath(file).pipe(Effect.catch(() => Effect.succeed(null)))
          if (!actual) continue
          const root = yield* fs.realPath(dir)
          if (!actual.startsWith(root + path.sep)) continue
          const stat = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(null)))
          if (stat?.type === 'File') return { path: file, mimeType }
        }
        return null
      })
    }

    function remove(id: string) {
      return Effect.gen(function* () {
        const found = yield* resolve(id)
        if (!found) return
        yield* fs.remove(found.path)
      }).pipe(Effect.ignore)
    }

    return { dir, persist, persistFile, resolve, remove }
  })
}

function decodeDataUrl(upload: UploadAttachment) {
  const invalid = (message: string) => Effect.fail(new StoreError('invalid_params', message))
  const prefix = `data:${upload.mimeType};base64,`
  if (!upload.dataUrl.startsWith(prefix)) {
    return invalid(`dataUrl must start with ${prefix.slice(0, 32)}… matching mimeType`)
  }
  const base64data = upload.dataUrl.slice(prefix.length)
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64data)) return invalid('dataUrl base64 payload is invalid')
  // Buffer.from returns empty rather than throwing on junk.
  const bytes = Buffer.from(base64data, 'base64')
  if (bytes.byteLength === 0) return invalid('dataUrl base64 payload is empty')
  return Effect.succeed({ bytes, base64data })
}
