import type { Attachment } from '@jetty/shared/items'

import { useEffect, useState } from 'react'

export const INLINE_IMAGE_MAX_HEIGHT = 480
export const BUBBLE_THUMBNAIL_SIZE = 48
export const GALLERY_GAP = 8

export function mediaUrl(attachment: Attachment) {
  return attachment.id.startsWith('blob:') ||
    attachment.id.startsWith('/') ||
    /^https?:\/\//.test(attachment.id)
    ? attachment.id
    : `/attachments/${attachment.id}`
}

// The same numbers drive the CSS box and the virtualizer estimate, so a row never jumps on load.
export function fittedSize(attachment: Attachment, maxWidth: number, maxHeight: number) {
  const { width, height } = attachment
  if (!width || !height) return undefined
  const fitted = Math.min(maxWidth, width, (maxHeight * width) / height)
  return { width: fitted, height: (fitted * height) / width }
}

export function fittedStyle(attachment: Attachment, maxHeight: number) {
  const { width, height } = attachment
  if (!width || !height) return undefined
  return {
    aspectRatio: `${width} / ${height}`,
    // Pair with max-w-full: a bare px width keeps the box's intrinsic size inside fit-content bubbles.
    width: `${Math.min(width, (maxHeight * width) / height)}px`,
  }
}

// Videos with unknown dimensions get a 16:9 frame and letterbox inside it.
export function videoHeight(video: Attachment, width: number) {
  return (
    fittedSize(video, width, INLINE_IMAGE_MAX_HEIGHT)?.height ??
    Math.min((width * 9) / 16, INLINE_IMAGE_MAX_HEIGHT)
  )
}

export function galleryColumns(count: number) {
  return count === 3 ? 3 : 2
}

export function galleryHeight(count: number, width: number) {
  const columns = galleryColumns(count)
  const rows = Math.ceil(count / columns)
  const cell = (width - GALLERY_GAP * (columns - 1)) / columns
  return rows * cell * 0.75 + (rows - 1) * GALLERY_GAP
}

type Size = { width: number; height: number }
const probedSizes = new Map<string, Promise<Size>>()

// Videos with no recorded dimensions read them from the file, once per source.
export function useVideoSize(src: string, enabled = true) {
  const [size, setSize] = useState<Size>()
  useEffect(() => {
    if (!enabled) return
    let live = true
    let probed = probedSizes.get(src)
    if (!probed) {
      probed = new Promise((resolve) => {
        const probe = document.createElement('video')
        probe.preload = 'metadata'
        probe.onloadedmetadata = () =>
          resolve({ width: probe.videoWidth, height: probe.videoHeight })
        probe.src = src
      })
      probedSizes.set(src, probed)
    }
    void probed.then((found) => {
      if (live) setSize(found)
    })
    return () => {
      live = false
    }
  }, [src, enabled])
  return size
}
