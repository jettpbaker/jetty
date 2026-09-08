import type { Attachment } from '@jetty/shared/items'

import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, newId, type UploadAttachment } from '@jetty/shared/wire'
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

const KIND_EXTS = {
  image: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']),
  video: new Set(['mp4', 'webm']),
} as const

const KIND_ACCEPT = {
  image: 'png, jpg, jpeg, gif, webp',
  video: 'mp4, webm',
} as const

const KIND_MAX = {
  image: MAX_IMAGE_BYTES,
  video: MAX_VIDEO_BYTES,
} as const

export type PersistKind = keyof typeof KIND_EXTS

/** Matches newId()/uuidv7 output — no slashes, dots, or traversal chars. */
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
      return Effect.suspend(() => {
        if (!uploads || uploads.length === 0) {
          return Effect.succeed({ meta: [], images: [] } satisfies PersistedAttachments)
        }

        const written: string[] = []
        const meta: Attachment[] = []
        const images: AgentImage[] = []

        return Effect.scoped(
          Effect.gen(function* () {
            const staging = yield* fs.makeTempDirectoryScoped({
              directory: dir,
              prefix: '.upload-',
            })
            for (const upload of uploads) {
              const { bytes, base64data } = yield* Effect.try({
                try: () => decodeDataUrl(upload),
                catch: (error) => error as StoreError,
              })
              if (bytes.byteLength > MAX_IMAGE_BYTES) {
                return yield* Effect.fail(
                  new StoreError(
                    'invalid_params',
                    `Image exceeds ${MAX_IMAGE_BYTES} bytes (got ${bytes.byteLength})`
                  )
                )
              }

              const id = newId()
              const ext = MIME_EXT[upload.mimeType]
              const filename = `${id}.${ext}`
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
            Effect.forEach(written, (file) => fs.remove(file).pipe(Effect.ignore), {
              discard: true,
            })
          )
        )
      })
    }

    function persistFile(srcPath: string, kind: PersistKind) {
      return Effect.scoped(
        Effect.gen(function* () {
          const stat = yield* fs
            .stat(srcPath)
            .pipe(
              Effect.mapError(
                () => new StoreError('invalid_params', `Cannot read ${kind} file: ${srcPath}`)
              )
            )
          if (stat.type !== 'File') {
            return yield* Effect.fail(
              new StoreError('invalid_params', `Not a regular file: ${srcPath}`)
            )
          }

          const rawExt = path.extname(srcPath).slice(1).toLowerCase()
          if (!KIND_EXTS[kind].has(rawExt)) {
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `Unsupported ${kind} type; accepted types: ${KIND_ACCEPT[kind]}`
              )
            )
          }
          const ext = rawExt === 'jpeg' ? 'jpg' : rawExt
          const mimeType = EXT_MIME[ext]!
          const noun = kind === 'image' ? 'Image' : 'Video'
          const maxBytes = KIND_MAX[kind]
          if (stat.size === 0n) {
            return yield* Effect.fail(
              new StoreError('invalid_params', `${noun} is empty: ${srcPath}`)
            )
          }
          if (stat.size > maxBytes) {
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `${noun} exceeds ${maxBytes} bytes (got ${stat.size})`
              )
            )
          }

          const id = newId()
          const dest = path.join(dir, `${id}.${ext}`)
          const staging = yield* fs.makeTempDirectoryScoped({ directory: dir, prefix: '.media-' })
          const temporary = path.join(staging, `${id}.${ext}`)
          return yield* Effect.gen(function* () {
            yield* fs.copyFile(srcPath, temporary)
            const copied = yield* fs.stat(temporary)
            if (copied.size === 0n || copied.size > maxBytes) {
              return yield* Effect.fail(
                new StoreError(
                  'invalid_params',
                  copied.size === 0n
                    ? `${noun} is empty: ${srcPath}`
                    : `${noun} exceeds ${maxBytes} bytes (got ${copied.size})`
                )
              )
            }
            yield* fs.rename(temporary, dest).pipe(Effect.uninterruptible)
            return {
              id,
              name: path.basename(srcPath),
              mimeType,
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
          // id is charset-checked; still refuse anything that escapes the attachments dir
          if (!file.startsWith(dir + path.sep)) continue
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

function decodeDataUrl(upload: UploadAttachment): { bytes: Buffer; base64data: string } {
  const prefix = `data:${upload.mimeType};base64,`
  if (!upload.dataUrl.startsWith(prefix)) {
    throw new StoreError(
      'invalid_params',
      `dataUrl must start with ${prefix.slice(0, 32)}… matching mimeType`
    )
  }

  const base64data = upload.dataUrl.slice(prefix.length)
  if (!base64data || !/^[A-Za-z0-9+/]+=*$/.test(base64data)) {
    throw new StoreError('invalid_params', 'dataUrl base64 payload is invalid')
  }

  // Buffer.from is lenient — it returns empty rather than throwing on junk.
  const bytes = Buffer.from(base64data, 'base64')
  if (bytes.byteLength === 0) {
    throw new StoreError('invalid_params', 'dataUrl base64 payload is empty')
  }

  return { bytes, base64data }
}
