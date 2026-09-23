import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_TURN,
  MAX_TURN_IMAGE_BYTES,
  UploadAttachment,
} from '@jetty/shared/wire'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

type ImageType = UploadAttachment['mimeType']

export type ComposerImage = {
  url: string
  name: string
  mimeType: ImageType
  sizeBytes: number
  dataUrl?: string
  width?: number
  height?: number
}
export type ReadyImage = ComposerImage & { dataUrl: string }
export type ImageAttachments = ReturnType<typeof useImageAttachments>

const imageTypes: readonly string[] = UploadAttachment.fields.mimeType.literals
export const imageAccept = imageTypes.join(',')

export function isImageType(type: string): type is ImageType {
  return imageTypes.includes(type)
}

let dropTarget: ((files: Iterable<File>) => void) | undefined

export function canDropImages() {
  return dropTarget !== undefined
}

export function dropImages(files: Iterable<File>) {
  dropTarget?.(files)
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

async function encode(file: File, type: ImageType) {
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

export function useImageAttachments() {
  const [images, setImages] = useState<readonly ComposerImage[]>([])
  const [error, setError] = useState<string>()
  const current = useRef(images)

  function update(next: readonly ComposerImage[]) {
    current.current = next
    setImages(next)
  }

  function patch(url: string, change: (image: ComposerImage) => ComposerImage | undefined) {
    update(current.current.flatMap((image) => (image.url === url ? (change(image) ?? []) : image)))
  }

  function drop(url: string, problem: string | undefined) {
    URL.revokeObjectURL(url)
    patch(url, () => undefined)
    setError(problem)
  }

  async function prepare(url: string, file: File, type: ImageType) {
    const encoded = await encode(file, type).catch(() => undefined)
    if (!current.current.some((image) => image.url === url)) return
    if (!encoded) return drop(url, `Couldn't read ${file.name}.`)
    const { blob, dataUrl, width, height } = encoded
    if (blob.size > MAX_IMAGE_BYTES) {
      return drop(url, `${file.name} must be under ${megabytes(MAX_IMAGE_BYTES)}.`)
    }
    const others = current.current.filter((image) => image.url !== url && image.dataUrl)
    if (others.reduce((sum, image) => sum + image.sizeBytes, blob.size) > MAX_TURN_IMAGE_BYTES) {
      return drop(url, `Images in one message must total under ${megabytes(MAX_TURN_IMAGE_BYTES)}.`)
    }
    const mimeType = isImageType(blob.type) ? blob.type : type
    patch(url, (image) => ({ ...image, mimeType, sizeBytes: blob.size, dataUrl, width, height }))
  }

  function add(files: Iterable<File>) {
    const problems: string[] = []
    const added: ComposerImage[] = []
    let overflow = false
    for (const file of files) {
      if (!isImageType(file.type)) {
        problems.push(`${file.name} isn't a PNG, JPEG, GIF or WebP image.`)
      } else if (file.size === 0) {
        problems.push(`${file.name} is empty.`)
      } else if (current.current.length + added.length >= MAX_IMAGES_PER_TURN) {
        overflow = true
      } else {
        const url = URL.createObjectURL(file)
        added.push({ url, name: file.name, mimeType: file.type, sizeBytes: file.size })
        void prepare(url, file, file.type)
      }
    }
    if (overflow) problems.push(`Up to ${MAX_IMAGES_PER_TURN} images per message.`)
    setError(problems.length > 0 ? problems.join(' ') : undefined)
    if (added.length > 0) update([...current.current, ...added])
  }

  function remove(url: string) {
    drop(url, undefined)
  }

  function take(): ReadyImage[] {
    const ready = current.current.flatMap((image) =>
      image.dataUrl ? [{ ...image, dataUrl: image.dataUrl }] : []
    )
    update([])
    setError(undefined)
    return ready
  }

  const receive = useEffectEvent((files: Iterable<File>) => add(files))

  useEffect(() => {
    dropTarget = receive
    return () => {
      if (dropTarget === receive) dropTarget = undefined
    }
  }, [])

  useEffect(
    () => () => {
      for (const image of current.current) URL.revokeObjectURL(image.url)
    },
    []
  )

  return {
    images,
    error,
    ready: images.every((image) => image.dataUrl),
    add,
    remove,
    take,
  }
}
