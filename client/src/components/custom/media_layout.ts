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

// Media of unknown dimensions holds a 16:9 frame: a video letterboxes inside it, an image waits.
export function frameHeight(width: number) {
  return Math.min((width * 9) / 16, INLINE_IMAGE_MAX_HEIGHT)
}

export function videoHeight(video: Attachment, width: number) {
  return fittedSize(video, width, INLINE_IMAGE_MAX_HEIGHT)?.height ?? frameHeight(width)
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
type Probed = Size | 'failed'
// Settled sizes are read during render, so a row the virtualizer remounts lays out at its final size.
const probedSizes = new Map<string, Probed>()
const probes = new Map<string, Promise<Probed>>()

function probeSize(src: string, video: boolean) {
  let pending = probes.get(src)
  if (!pending) {
    pending = new Promise<Probed>((resolve) => {
      if (video) {
        const probe = document.createElement('video')
        probe.preload = 'metadata'
        probe.onloadedmetadata = () =>
          resolve({ width: probe.videoWidth, height: probe.videoHeight })
        probe.src = src
      } else {
        const probe = new Image()
        probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
        probe.onerror = () => resolve('failed')
        probe.src = src
      }
    })
    void pending.then((found) => probedSizes.set(src, found))
    probes.set(src, pending)
  }
  return pending
}

// Media with no recorded dimensions reads them from the file, once per source.
function useProbedSize(src: string, video: boolean, enabled: boolean) {
  const [probed, setProbed] = useState(() => ({ src, size: probedSizes.get(src) }))
  useEffect(() => {
    if (!enabled) return
    let live = true
    void probeSize(src, video).then((size) => {
      if (live)
        setProbed((current) =>
          current.src === src && current.size === size ? current : { src, size }
        )
    })
    return () => {
      live = false
    }
  }, [src, video, enabled])
  return enabled && probed.src === src ? probed.size : undefined
}

export function useVideoSize(src: string, enabled = true) {
  const size = useProbedSize(src, true, enabled)
  return size === 'failed' ? undefined : size
}

export function useImageSize(src: string, enabled = true) {
  return useProbedSize(src, false, enabled)
}
