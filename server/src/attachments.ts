import type { Attachment } from '@jetty/shared/items'

import {
  isImageMimeType,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TURN_ATTACHMENT_BYTES,
  MAX_VIDEO_BYTES,
  newId,
  type ImageMimeType,
  type UploadAttachment,
} from '@jetty/shared/wire'
import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

import type { AgentImage } from './agent'

import { imageSize } from './image-size'
import { StoreError } from './store'
import { videoSize } from './video-size'

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

export function fileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// A file keeps its name, in a folder of its own, so the agent reads ci.log rather than an id.
export function safeFileName(name: string) {
  const safe = [...name]
    .map((char) => {
      const code = char.charCodeAt(0)
      return char === '/' || char === '\\' || code < 32 || code === 127 ? '_' : char
    })
    .join('')
    .trim()
    .slice(0, 200)
  return safe === '' || safe === '.' || safe === '..' ? 'file' : safe
}

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
            const image = isImageMimeType(upload.mimeType) ? upload.mimeType : undefined
            const limit = image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
            if (bytes.byteLength > limit) {
              return yield* Effect.fail(
                new StoreError(
                  'invalid_params',
                  `${image ? 'Image' : 'File'} exceeds ${limit} bytes (got ${bytes.byteLength})`
                )
              )
            }
            totalBytes += bytes.byteLength
            if (totalBytes > MAX_TURN_ATTACHMENT_BYTES) {
              return yield* Effect.fail(
                new StoreError(
                  'invalid_params',
                  `Attachments exceed ${MAX_TURN_ATTACHMENT_BYTES} bytes in total`
                )
              )
            }

            const id = newId()
            const entry = image ? `${id}.${MIME_EXT[image]}` : id
            const destination = path.join(dir, entry)
            if (image) yield* fs.writeFile(path.join(staging, entry), bytes)
            else {
              yield* fs.makeDirectory(path.join(staging, entry))
              yield* fs.writeFile(path.join(staging, entry, safeFileName(upload.name)), bytes)
            }
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                written.push(destination)
                yield* fs.rename(path.join(staging, entry), destination)
              })
            )

            meta.push({
              id,
              name: upload.name,
              mimeType: upload.mimeType,
              sizeBytes: bytes.byteLength,
              ...(image ? imageSize(bytes) : {}),
            })
            if (image) images.push({ mimeType: image, base64data })
          }
          return { meta, images }
        })
      ).pipe(
        Effect.onError(() =>
          Effect.forEach(
            written,
            (file) => fs.remove(file, { recursive: true }).pipe(Effect.ignore),
            { discard: true }
          )
        )
      )
    }

    function persistFile(srcPath: string, kind: PersistKind, source?: FileHandle) {
      const { noun, exts, maxBytes } = KINDS[kind]
      const invalid = (message: string) => Effect.fail(new StoreError('invalid_params', message))

      function checkSize(size: bigint) {
        if (size === 0n) return invalid(`${noun} is empty: ${srcPath}`)
        if (size > maxBytes)
          return invalid(`${noun} is over the ${maxBytes / 1024 / 1024} MB limit`)
        return Effect.void
      }

      return Effect.scoped(
        Effect.gen(function* () {
          const file =
            source ??
            (yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: () => open(srcPath, constants.O_RDONLY | constants.O_NONBLOCK),
                catch: () =>
                  new StoreError('invalid_params', `Cannot read ${kind} file: ${srcPath}`),
              }),
              (file) => Effect.promise(() => file.close())
            ))
          const stat = yield* Effect.tryPromise({
            try: () => file.stat(),
            catch: () => new StoreError('invalid_params', `Cannot read ${kind} file: ${srcPath}`),
          })
          if (!stat.isFile()) return yield* invalid(`Not a regular file: ${srcPath}`)

          const rawExt = path.extname(srcPath).slice(1).toLowerCase()
          if (!exts.includes(rawExt)) {
            return yield* invalid(`Unsupported ${kind} type; accepted types: ${exts.join(', ')}`)
          }
          const ext = rawExt === 'jpeg' ? 'jpg' : rawExt
          yield* checkSize(BigInt(stat.size))

          const id = newId()
          const dest = path.join(dir, `${id}.${ext}`)
          const staging = yield* fs.makeTempDirectoryScoped({ directory: dir, prefix: '.media-' })
          const temporary = path.join(staging, `${id}.${ext}`)
          return yield* Effect.gen(function* () {
            const destination = yield* fs.open(temporary, { flag: 'w' })
            const buffer = Buffer.alloc(64 * 1024)
            let size = 0
            while (true) {
              const { bytesRead } = yield* Effect.tryPromise(() =>
                file.read(buffer, 0, buffer.length, size)
              )
              if (!bytesRead) break
              size += bytesRead
              yield* checkSize(BigInt(size))
              yield* destination.writeAll(buffer.subarray(0, bytesRead))
            }
            const copied = yield* fs.stat(temporary)
            yield* checkSize(copied.size)
            const dimensions =
              kind === 'image'
                ? imageSize(yield* fs.readFile(temporary))
                : yield* Effect.promise(() => videoSize(temporary))
            yield* fs.rename(temporary, dest).pipe(Effect.uninterruptible)
            return {
              id,
              name: path.basename(srcPath),
              mimeType: EXT_MIME[ext]!,
              sizeBytes: Number(copied.size),
              ...dimensions,
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

    // An image or video is <id>.<ext>; any other file is the one file in folder <id>, which
    // `entry` names so it goes as a whole.
    function resolve(id: string) {
      return Effect.gen(function* () {
        if (!ATTACHMENT_ID_RE.test(id)) return null
        const root = yield* fs.realPath(dir)
        const inside = (file: string) =>
          fs.realPath(file).pipe(
            Effect.map((actual) => actual.startsWith(root + path.sep)),
            Effect.catch(() => Effect.succeed(false))
          )

        for (const [ext, mimeType] of Object.entries(EXT_MIME)) {
          const file = path.join(dir, `${id}.${ext}`)
          if (!(yield* inside(file))) continue
          const stat = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(null)))
          if (stat?.type === 'File') return { path: file, mimeType, entry: file, file: false }
        }
        const folder = path.join(dir, id)
        if (!(yield* inside(folder))) return null
        const names = yield* fs.readDirectory(folder).pipe(Effect.catch(() => Effect.succeed([])))
        for (const name of names) {
          const file = path.join(folder, name)
          if (!(yield* inside(file))) continue
          const stat = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(null)))
          if (stat?.type === 'File')
            return { path: file, mimeType: 'application/octet-stream', entry: folder, file: true }
        }
        return null
      })
    }

    // Reads persisted images back for delivery, e.g. a queued message's attachments. Files go as
    // paths, so they have nothing to load.
    function load(meta: readonly Attachment[]) {
      return Effect.forEach(meta.filter(isImage), (attachment) =>
        Effect.gen(function* () {
          const found = yield* resolve(attachment.id)
          if (!found)
            return yield* Effect.fail(new StoreError('not_found', 'Attachment is missing'))
          const bytes = yield* fs.readFile(found.path)
          return {
            mimeType: attachment.mimeType as ImageMimeType,
            base64data: Buffer.from(bytes).toString('base64'),
          }
        })
      ).pipe(
        Effect.mapError((error) =>
          error instanceof StoreError ? error : new StoreError('internal', String(error))
        )
      )
    }

    function remove(id: string) {
      return Effect.gen(function* () {
        const found = yield* resolve(id)
        if (!found) return
        yield* fs.remove(found.entry, { recursive: true })
      }).pipe(Effect.ignore)
    }

    // Clears what a crash or a failed removal left behind: upload staging folders, and files no
    // thread holds any more. Runs at startup, before any upload can be in flight.
    function sweep(held: ReadonlySet<string>) {
      return Effect.gen(function* () {
        for (const name of yield* fs.readDirectory(dir)) {
          const id = name.split('.')[0]!
          if (
            name.startsWith('.upload-') ||
            name.startsWith('.media-') ||
            (ATTACHMENT_ID_RE.test(id) && !held.has(id))
          )
            yield* fs.remove(path.join(dir, name), { recursive: true }).pipe(Effect.ignore)
        }
      })
    }

    return { dir, persist, persistFile, resolve, load, remove, sweep }
  })
}

function isImage(attachment: Attachment): attachment is Attachment & { mimeType: ImageMimeType } {
  return isImageMimeType(attachment.mimeType)
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
