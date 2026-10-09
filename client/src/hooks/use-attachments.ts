import type { ClipboardEvent } from 'react'

import { revokeBlobUrl } from '@/lib/blob_urls'
import { useDraft } from '@/state'
import {
  isImageMimeType,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TURN_ATTACHMENT_BYTES,
  type ImageMimeType,
} from '@jetty/shared/wire'
import { useEffect, useEffectEvent, useState } from 'react'

// An image goes to the agent inline; any other file goes as a path to Jetty's copy of it.
export type ComposerAttachment = {
  url: string
  name: string
  mimeType: string
  sizeBytes: number
  dataUrl?: string
  width?: number
  height?: number
  // why it can't be sent, for a composer that keeps failed attachments in view
  error?: string
}
export type ReadyAttachment = ComposerAttachment & { dataUrl: string }
export type Attachments = ReturnType<typeof useAttachments>

export const isImageType = isImageMimeType

// Pasting more than this much plain text attaches it as a file instead of filling the composer.
const LONG_PASTE_CHARACTERS = 2000
const PASTED_TEXT_NAME = 'Pasted text'

let dropTarget: ((files: Iterable<File>, folders: number) => void) | undefined

export function canDropAttachments() {
  return dropTarget !== undefined
}

export function dropAttachments(files: Iterable<File>, folders: number) {
  dropTarget?.(files, folders)
}

// Claude downscales anything longer than this anyway; sending more only slows the upload.
const MAX_IMAGE_EDGE = 2576
const megabytes = (bytes: number) => `${bytes / 1024 / 1024} MB`

function readDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(blob)
  })
}

// The type a data URL declares, parameters and all, so the server can match it exactly.
function dataUrlType(dataUrl: string) {
  return dataUrl.slice('data:'.length, dataUrl.indexOf(';base64,'))
}

async function encode(file: File, type: ImageMimeType) {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    let blob: Blob = file
    if (scale < 1) {
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no 2d context')
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, width, height)
      // GIFs keep only their first frame, which is all Claude reads.
      blob = await canvas.convertToBlob(
        type === 'image/gif' || type === 'image/png'
          ? { type: 'image/png' }
          : { type, quality: 0.92 }
      )
    }
    return { blob, width, height, dataUrl: await readDataUrl(blob) }
  } finally {
    bitmap.close()
  }
}

async function readAttachment(file: File) {
  const type = file.type
  if (isImageType(type)) {
    const encoded = await encode(file, type).catch(() => undefined)
    if (!encoded) return undefined
    const { blob, dataUrl, width, height } = encoded
    return { size: blob.size, mimeType: dataUrlType(dataUrl), dataUrl, width, height }
  }
  const dataUrl = await readDataUrl(file).catch(() => undefined)
  if (!dataUrl) return undefined
  return { size: file.size, mimeType: dataUrlType(dataUrl), dataUrl }
}

function lostNotice(names: readonly string[] | undefined) {
  if (!names?.length) return undefined
  const one = names.length === 1
  return `${names.join(', ')} ${one ? 'was' : 'were'} too large to keep through the reload. Attach ${one ? 'it' : 'them'} again.`
}

// A queued message keeps the attachments it was queued with; an edit changes its text.
const editingNotice = "Attachments can't be added while editing a queued message."

// keepFailed leaves an attachment that can't be used in the row with its reason, rather than
// dropping it with a notice under the composer.
export function useAttachments(
  key: string,
  { editing = false, keepFailed = false }: { editing?: boolean; keepFailed?: boolean } = {}
) {
  const { draft, update: updateDraft, read } = useDraft(key)
  const items = draft.attachments
  const [error, setError] = useState<string>()
  const current = () => read().attachments

  function update(next: readonly ComposerAttachment[]) {
    updateDraft({ attachments: next, lostAttachments: undefined })
  }

  function patch(
    url: string,
    change: (item: ComposerAttachment) => ComposerAttachment | undefined
  ) {
    update(current().flatMap((item) => (item.url === url ? (change(item) ?? []) : item)))
  }

  function drop(url: string, problem: string | undefined) {
    revokeBlobUrl(url)
    patch(url, () => undefined)
    setError(problem)
  }

  function fail(url: string, problem: string) {
    if (!keepFailed) return drop(url, problem)
    patch(url, (item) => ({ ...item, error: problem }))
  }

  async function prepare(url: string, file: File) {
    const prepared = await readAttachment(file)
    if (!current().some((item) => item.url === url)) return
    if (!prepared) return fail(url, `Couldn't read ${file.name}.`)
    const limit = isImageType(file.type) ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
    if (prepared.size > limit) return fail(url, `${file.name} must be under ${megabytes(limit)}.`)
    const others = current().filter((item) => item.url !== url && item.dataUrl)
    const total = others.reduce((sum, item) => sum + item.sizeBytes, prepared.size)
    if (total > MAX_TURN_ATTACHMENT_BYTES)
      return fail(
        url,
        `Attachments in one message must total under ${megabytes(MAX_TURN_ATTACHMENT_BYTES)}.`
      )
    const { size, ...rest } = prepared
    patch(url, (item) => ({ ...item, ...rest, sizeBytes: size }))
  }

  function add(files: Iterable<File>, folders = 0) {
    if (editing) return setError(editingNotice)
    const problems: string[] = []
    const added: ComposerAttachment[] = []
    let overflow = false
    for (const file of files) {
      if (file.size === 0) {
        problems.push(`${file.name} is empty.`)
      } else if (current().length + added.length >= MAX_ATTACHMENTS_PER_TURN) {
        overflow = true
      } else {
        const url = URL.createObjectURL(file)
        const item = { url, name: file.name, mimeType: file.type, sizeBytes: file.size }
        // Images shrink on the way in, so only a file can be too big before it's read.
        if (!isImageType(file.type) && file.size > MAX_FILE_BYTES) {
          const problem = `${file.name} must be under ${megabytes(MAX_FILE_BYTES)}.`
          if (keepFailed) added.push({ ...item, error: problem })
          else {
            revokeBlobUrl(url)
            problems.push(problem)
          }
          continue
        }
        added.push(item)
        void prepare(url, file)
      }
    }
    if (folders > 0) problems.push('Attach files, not folders.')
    if (overflow) problems.push(`Up to ${MAX_ATTACHMENTS_PER_TURN} attachments per message.`)
    setError(problems.length > 0 ? problems.join(' ') : undefined)
    if (added.length > 0) update([...current(), ...added])
  }

  // Files paste as attachments, and so does a long run of plain text.
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const { files } = event.clipboardData
    if (files.length > 0) {
      event.preventDefault()
      add(files)
      return
    }
    const text = event.clipboardData.getData('text/plain')
    if (text.length <= LONG_PASTE_CHARACTERS) return
    event.preventDefault()
    add([new File([text], PASTED_TEXT_NAME, { type: 'text/plain' })])
  }

  function remove(url: string) {
    drop(url, undefined)
  }

  function take(): ReadyAttachment[] {
    const ready = current().flatMap((item) =>
      item.dataUrl ? [{ ...item, dataUrl: item.dataUrl }] : []
    )
    for (const item of current()) if (item.error) revokeBlobUrl(item.url)
    update([])
    setError(undefined)
    return ready
  }

  const receive = useEffectEvent((files: Iterable<File>, folders: number) => add(files, folders))

  useEffect(() => {
    dropTarget = receive
    return () => {
      if (dropTarget === receive) dropTarget = undefined
    }
  }, [])

  return {
    items,
    error:
      (error === editingNotice && !editing ? undefined : error) ??
      lostNotice(draft.lostAttachments),
    // why attachments can't be added now
    refused: editing ? editingNotice : undefined,
    ready: items.every((item) => item.dataUrl || item.error),
    add,
    paste,
    remove,
    take,
  }
}
