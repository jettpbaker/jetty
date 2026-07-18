import type { FileUIPart } from 'ai'

import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_TURN, type UploadAttachment } from '@jetty/shared/wire'
import { toast } from 'sonner'

const MAX_IMAGE_SIDE = 8000

type ImageMime = UploadAttachment['mimeType']

function isImageMime(type: string | undefined): type is ImageMime {
  return (
    type === 'image/png' || type === 'image/jpeg' || type === 'image/gif' || type === 'image/webp'
  )
}

async function withinDimensions(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file)
    const ok = bitmap.width <= MAX_IMAGE_SIDE && bitmap.height <= MAX_IMAGE_SIDE
    bitmap.close()
    return ok
  } catch {
    return true
  }
}

// Every add path (paste, drop, file dialog) funnels through validateFiles.
export async function acceptImages(incoming: File[], currentCount: number): Promise<File[]> {
  const accepted: File[] = []
  let overflowed = false
  for (const file of incoming) {
    if (currentCount + accepted.length >= MAX_IMAGES_PER_TURN) {
      overflowed = true
      break
    }
    if (!isImageMime(file.type)) {
      toast.error(`${file.name || 'File'} isn’t a supported image (PNG, JPEG, GIF, WebP).`)
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(`${file.name || 'Image'} is larger than 10 MB.`)
      continue
    }
    if (!(await withinDimensions(file))) {
      toast.error(`${file.name || 'Image'} exceeds 8000 px on a side.`)
      continue
    }
    accepted.push(file)
  }
  if (overflowed) {
    toast.error(`You can attach up to ${MAX_IMAGES_PER_TURN} images.`)
  }
  return accepted
}

export function toUploadAttachments(files: FileUIPart[]): UploadAttachment[] {
  const attachments: UploadAttachment[] = []
  for (const file of files) {
    if (file.url && isImageMime(file.mediaType)) {
      attachments.push({
        name: file.filename ?? 'image',
        mimeType: file.mediaType,
        dataUrl: file.url,
      })
    }
  }
  return attachments
}
