import type { Attachment } from '@jetty/shared/items'

export const INLINE_IMAGE_MAX_HEIGHT = 480
export const BUBBLE_IMAGE_MAX_HEIGHT = 256
export const GALLERY_GAP = 8
export const VIDEO_CARD_HEIGHT = 98

export function mediaUrl(attachment: Attachment) {
  return attachment.id.startsWith('blob:') ? attachment.id : `/attachments/${attachment.id}`
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

export function galleryColumns(count: number) {
  return count === 3 ? 3 : 2
}

export function galleryHeight(count: number, width: number) {
  const columns = galleryColumns(count)
  const rows = Math.ceil(count / columns)
  const cell = (width - GALLERY_GAP * (columns - 1)) / columns
  return rows * cell * 0.75 + (rows - 1) * GALLERY_GAP
}
