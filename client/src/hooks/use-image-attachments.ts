import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_TURN, UploadAttachment } from '@jetty/shared/wire'
import { useEffect, useRef, useState } from 'react'

type ImageType = UploadAttachment['mimeType']

export type ComposerImage = {
  url: string
  name: string
  mimeType: ImageType
  sizeBytes: number
  dataUrl?: string
}
export type ReadyImage = ComposerImage & { dataUrl: string }
export type ImageAttachments = ReturnType<typeof useImageAttachments>

const imageTypes: readonly string[] = UploadAttachment.fields.mimeType.literals
export const imageAccept = imageTypes.join(',')

function isImageType(type: string): type is ImageType {
  return imageTypes.includes(type)
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
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

  function add(files: Iterable<File>) {
    const problems: string[] = []
    const added: ComposerImage[] = []
    let overflow = false
    for (const file of files) {
      if (!isImageType(file.type)) {
        problems.push(`${file.name} isn't a PNG, JPEG, GIF or WebP image.`)
      } else if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
        problems.push(`${file.name} must be under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
      } else if (current.current.length + added.length >= MAX_IMAGES_PER_TURN) {
        overflow = true
      } else {
        const url = URL.createObjectURL(file)
        added.push({ url, name: file.name, mimeType: file.type, sizeBytes: file.size })
        readDataUrl(file).then(
          (dataUrl) => patch(url, (image) => ({ ...image, dataUrl })),
          () => {
            URL.revokeObjectURL(url)
            patch(url, () => undefined)
            setError(`Couldn't read ${file.name}.`)
          }
        )
      }
    }
    if (overflow) problems.push(`Up to ${MAX_IMAGES_PER_TURN} images per message.`)
    setError(problems.length > 0 ? problems.join(' ') : undefined)
    if (added.length > 0) update([...current.current, ...added])
  }

  function remove(url: string) {
    URL.revokeObjectURL(url)
    patch(url, () => undefined)
    setError(undefined)
  }

  function take(): ReadyImage[] {
    const ready = current.current.flatMap((image) =>
      image.dataUrl ? [{ ...image, dataUrl: image.dataUrl }] : []
    )
    update([])
    setError(undefined)
    return ready
  }

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
