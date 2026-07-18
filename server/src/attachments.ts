import type { Attachment } from '@jetty/shared/items'

import { MAX_IMAGE_BYTES, newId, type UploadAttachment } from '@jetty/shared/wire'
import { mkdirSync, unlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

import type { AgentImage } from './agent'

import { StoreError } from './store'

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
} as const

const EXT_MIME: Record<string, UploadAttachment['mimeType']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Matches newId()/uuidv7 output — no slashes, dots, or traversal chars. */
const ATTACHMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PersistedAttachments = {
  meta: Attachment[]
  images: AgentImage[]
}

export type Attachments = ReturnType<typeof createAttachments>

export function createAttachments(home: string) {
  const dir = join(home, 'attachments')
  mkdirSync(dir, { recursive: true })

  function persist(uploads: UploadAttachment[] | undefined): PersistedAttachments {
    if (!uploads || uploads.length === 0) {
      return { meta: [], images: [] }
    }

    const written: string[] = []
    const meta: Attachment[] = []
    const images: AgentImage[] = []

    try {
      for (const upload of uploads) {
        const { bytes, base64data } = decodeDataUrl(upload)
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          throw new StoreError(
            'invalid_params',
            `Image exceeds ${MAX_IMAGE_BYTES} bytes (got ${bytes.byteLength})`
          )
        }

        const id = newId()
        const ext = MIME_EXT[upload.mimeType]
        const filename = `${id}.${ext}`
        const path = join(dir, filename)
        writeFileSync(path, bytes)
        written.push(path)

        meta.push({
          id,
          name: upload.name,
          mimeType: upload.mimeType,
          sizeBytes: bytes.byteLength,
        })
        images.push({ mimeType: upload.mimeType, base64data })
      }
    } catch (err) {
      for (const path of written) {
        try {
          unlinkSync(path)
        } catch {
          // best-effort cleanup
        }
      }
      throw err
    }

    return { meta, images }
  }

  function resolve(id: string): { path: string; mimeType: string } | null {
    if (!ATTACHMENT_ID_RE.test(id)) return null

    for (const [ext, mimeType] of Object.entries(EXT_MIME)) {
      const path = join(dir, `${id}.${ext}`)
      // id is charset-checked; still refuse anything that escapes the attachments dir
      if (!path.startsWith(dir + sep)) continue
      if (existsSync(path)) return { path, mimeType }
    }
    return null
  }

  return { dir, persist, resolve }
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

  let bytes: Buffer
  try {
    bytes = Buffer.from(base64data, 'base64')
  } catch {
    throw new StoreError('invalid_params', 'dataUrl base64 payload is invalid')
  }

  // Buffer.from is lenient; reject empty / clearly non-decodable payloads.
  if (bytes.byteLength === 0) {
    throw new StoreError('invalid_params', 'dataUrl base64 payload is empty')
  }

  return { bytes, base64data }
}
