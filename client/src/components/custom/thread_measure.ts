import { layout, prepare, type PreparedText } from '@chenglou/pretext'

import type { ThreadRow } from './thread_rows'

import {
  BUBBLE_THUMBNAIL_SIZE,
  fittedSize,
  galleryHeight,
  INLINE_IMAGE_MAX_HEIGHT,
  videoHeight,
} from './media_layout'
import {
  collapseAfterHeight,
  collapsedTextHeight,
  collapsibleTexts,
  expandedMessages,
} from './user_message'
import { groupWorkActivities, previewCount, workEnded } from './work_model'

const font = '14px "Geist Variable"'
const lineHeight = 23
// The footer under a message, and the bubble's gap above it.
const footerRow = 28
// Geist's mean advance at 14px, for rough line counts that skip text layout.
const charWidth = 6.5
type Measured = { text: string; prepared: PreparedText; width?: number; height: number }
const cache = new Map<string, Measured>()

export function clearTextMeasure() {
  cache.clear()
  collapsibleTexts.clear()
}

function roughHeight(text: string, width: number, preWrap: boolean) {
  const perLine = Math.max(1, Math.floor(width / charWidth))
  let lines = 0
  for (const line of preWrap ? text.split('\n') : [text])
    lines += Math.max(1, Math.ceil(line.length / perLine))
  return lines * lineHeight
}

function textHeight(id: string, text: string, width: number, preWrap: boolean, rough: boolean) {
  if (rough) return roughHeight(text, width, preWrap)
  let entry = cache.get(id)
  if (!entry || entry.text !== text) {
    entry = {
      text,
      prepared: prepare(text || ' ', font, preWrap ? { whiteSpace: 'pre-wrap' } : undefined),
      height: 0,
    }
    cache.set(id, entry)
  }
  if (entry.width !== width) {
    entry.width = width
    entry.height = layout(entry.prepared, Math.max(1, width), lineHeight).height
  }
  return entry.height
}

function captionHeight(id: string, caption: string | undefined, width: number, rough: boolean) {
  return caption ? textHeight(`${id}:caption`, caption, width, false, rough) + 8 : 0
}

// Rough estimates count lines from text length instead of laying the text out.
export function estimateRow(row: ThreadRow, width: number, rough = false) {
  switch (row.kind) {
    case 'subagentDone':
      return 29
    case 'reports': {
      let height = 4 + 25 * row.reports.length
      for (const [index, report] of row.reports.entries())
        if (report.question)
          height += textHeight(`${row.id}:${index}`, report.question, width, true, rough) + 4
      return height
    }
    case 'user': {
      const { text, attachments } = row.item
      const images = attachments.some((attachment) => attachment.mimeType.startsWith('image/'))
      const full = text ? textHeight(row.id, text, width * 0.8, true, rough) : 0
      let height =
        28 +
        footerRow +
        (full > collapseAfterHeight
          ? (expandedMessages.has(row.item.id) ? full : collapsedTextHeight) + 28
          : full)
      if (row.item.from) height += 22
      if (images) height += BUBBLE_THUMBNAIL_SIZE + (text ? 8 : 0)
      for (const attachment of attachments)
        if (!attachment.mimeType.startsWith('image/')) height += lineHeight
      return height
    }
    case 'assistant':
    case 'plan':
      return (
        textHeight(row.id, row.item.text, width, false, rough) +
        8 +
        (row.footer === undefined ? 4 : footerRow)
      )
    case 'work': {
      if (workEnded(row.status)) return 30
      let height = 32
      for (const entry of groupWorkActivities(row.activities, false).slice(-previewCount)) {
        if (entry.type === 'text')
          height += textHeight(entry.id, entry.text, width - 16, false, rough) + 4
        else height += 28
        if (entry.type === 'thinking' && entry.summary && entry.status === 'running')
          height += Math.min(72, textHeight(entry.id, entry.summary, width, true, rough))
      }
      return height
    }
    case 'error':
      return textHeight(row.id, row.message, width * 0.8, true, rough) + 24
    case 'gallery':
      return (
        (row.item.images.length === 1
          ? (fittedSize(row.item.images[0]!, width, INLINE_IMAGE_MAX_HEIGHT)?.height ??
            INLINE_IMAGE_MAX_HEIGHT)
          : galleryHeight(row.item.images.length, width)) +
        captionHeight(row.id, row.item.caption, width, rough)
      )
    case 'video':
      return (
        videoHeight(row.item.video, width) + captionHeight(row.id, row.item.caption, width, rough)
      )
    case 'subagents':
      return 44 + 50 * row.agents.length
    case 'workflow':
      return row.item.status === 'running'
        ? 72 + 32 * row.item.phases.length + 28 * row.item.agents.length
        : 36
    case 'compaction':
    case 'restart':
    case 'restartLimit':
      return 24
    case 'marker':
      return 16
  }
}
