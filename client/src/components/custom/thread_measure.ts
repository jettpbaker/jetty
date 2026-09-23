import { layout, prepare, type PreparedText } from '@chenglou/pretext'

import type { ThreadRow } from './thread_rows'

import {
  BUBBLE_THUMBNAIL_SIZE,
  fittedSize,
  galleryHeight,
  INLINE_IMAGE_MAX_HEIGHT,
  videoHeight,
} from './media_layout'

const font = '14px "Geist Variable"'
const lineHeight = 23
const cache = new Map<string, { text: string; prepared: PreparedText }>()

export function clearTextMeasure() {
  cache.clear()
}

function textHeight(id: string, text: string, width: number, preWrap: boolean) {
  let entry = cache.get(id)
  if (!entry || entry.text !== text) {
    entry = {
      text,
      prepared: prepare(text || ' ', font, preWrap ? { whiteSpace: 'pre-wrap' } : undefined),
    }
    cache.set(id, entry)
  }
  return layout(entry.prepared, Math.max(1, width), lineHeight).height
}

function captionHeight(id: string, caption: string | undefined, width: number) {
  return caption ? textHeight(`${id}:caption`, caption, width, false) + 8 : 0
}

export function estimateRow(row: ThreadRow, width: number) {
  switch (row.kind) {
    case 'user': {
      const { text, attachments } = row.item
      const images = attachments.some((attachment) => attachment.mimeType.startsWith('image/'))
      let height = 16 + (text ? textHeight(row.id, text, width * 0.8, true) : 0)
      if (row.item.from) height += 22
      if (images) height += BUBBLE_THUMBNAIL_SIZE + (text ? 8 : 0)
      for (const attachment of attachments)
        if (!attachment.mimeType.startsWith('image/')) height += lineHeight
      return height
    }
    case 'assistant':
    case 'plan':
      return textHeight(row.id, row.item.text, width, false) + 8
    case 'work': {
      let height = 32
      for (const activity of row.activities) {
        height += 28
        if (activity.type === 'thinking' && activity.summary && activity.status === 'running')
          height += Math.min(72, textHeight(activity.id, activity.summary, width, true))
      }
      return height
    }
    case 'error':
      return textHeight(row.id, row.message, width * 0.8, true) + 24
    case 'gallery':
      return (
        (row.item.images.length === 1
          ? (fittedSize(row.item.images[0]!, width, INLINE_IMAGE_MAX_HEIGHT)?.height ??
            INLINE_IMAGE_MAX_HEIGHT)
          : galleryHeight(row.item.images.length, width)) +
        captionHeight(row.id, row.item.caption, width)
      )
    case 'video':
      return videoHeight(row.item.video, width) + captionHeight(row.id, row.item.caption, width)
    case 'subagents':
      return 44 + 50 * row.agents.length
    case 'workflow':
      return row.item.status === 'running'
        ? 72 + 32 * row.item.phases.length + 28 * row.item.agents.length
        : 36
    case 'created':
      return 28 * row.threadIds.length
    case 'marker':
      return 16
  }
}
