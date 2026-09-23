import { layout, prepare, type PreparedText } from '@chenglou/pretext'

import type { ThreadRow } from './thread_rows'

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
  return caption ? textHeight(`${id}:caption`, caption, width * 0.8, false) + 8 : 0
}

export function estimateRow(row: ThreadRow, width: number) {
  switch (row.kind) {
    case 'user':
      return (
        textHeight(row.id, row.item.text, width * 0.8, true) +
        16 +
        (row.item.attachments.length ? 72 : 0)
      )
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
        160 * Math.ceil(row.item.images.length / 2) + captionHeight(row.id, row.item.caption, width)
      )
    case 'video':
      return 180 + captionHeight(row.id, row.item.caption, width)
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
