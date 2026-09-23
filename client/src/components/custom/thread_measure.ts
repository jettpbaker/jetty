import { layout, prepare, type PreparedText } from '@chenglou/pretext'

import type { ThreadRow } from './thread_rows'

import {
  BUBBLE_IMAGE_MAX_HEIGHT,
  fittedSize,
  galleryHeight,
  INLINE_IMAGE_MAX_HEIGHT,
  VIDEO_CARD_HEIGHT,
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
      let height = textHeight(row.id, row.item.text, width * 0.8, true) + 16
      for (const attachment of row.item.attachments)
        height += attachment.mimeType.startsWith('image/')
          ? 8 +
            (fittedSize(attachment, width * 0.8 - 24, BUBBLE_IMAGE_MAX_HEIGHT)?.height ??
              BUBBLE_IMAGE_MAX_HEIGHT)
          : lineHeight
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
      return VIDEO_CARD_HEIGHT
    case 'subagents':
      return 44 + 50 * row.agents.length
    case 'question': {
      let height = 24
      for (const spec of row.item.questions) {
        height += textHeight(`${row.id}:${spec.question}`, spec.question, width * 0.8, false)
        height += 20 * spec.options.length + 16
      }
      return height
    }
  }
}
