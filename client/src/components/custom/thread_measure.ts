import { layout, prepare, type PreparedText } from '@chenglou/pretext'

import type { ThreadRow } from './thread_rows'

const font = '14px "Geist Variable"'
const lineHeight = 23
const cache = new Map<string, { text: string; prepared: PreparedText }>()

export function clearTextMeasure() {
  cache.clear()
}

function textHeight(id: string, text: string, width: number, preWrap: boolean, epoch: number) {
  const key = `${epoch}:${id}:${preWrap ? 'pre' : 'plain'}`
  let entry = cache.get(key)
  if (!entry || entry.text !== text) {
    entry = {
      text,
      prepared: prepare(text || ' ', font, preWrap ? { whiteSpace: 'pre-wrap' } : undefined),
    }
    cache.set(key, entry)
  }
  return layout(entry.prepared, Math.max(1, width), lineHeight).height
}

function estimateWork(row: Extract<ThreadRow, { kind: 'work' }>, width: number, epoch: number) {
  let height = 32
  for (const activity of row.activities) {
    height += 28
    if (activity.type === 'thinking' && activity.summary && activity.status === 'running')
      height += Math.min(72, textHeight(activity.id, activity.summary, width, true, epoch))
  }
  return height
}

export function estimateRow(row: ThreadRow, columnWidth: number, epoch: number) {
  const width = Math.max(1, columnWidth)
  switch (row.kind) {
    case 'user':
      return (
        textHeight(row.id, row.item.text, width * 0.8, true, epoch) +
        16 +
        (row.item.attachments.length ? 72 : 0)
      )
    case 'assistant':
    case 'plan':
      return textHeight(row.id, row.item.text, width, false, epoch) + 8
    case 'work':
      return estimateWork(row, width, epoch)
    case 'error':
      return textHeight(row.id, row.message, width * 0.8, true, epoch) + 24
    case 'gallery':
      return (
        160 * Math.ceil(row.item.images.length / 2) +
        (row.item.caption
          ? textHeight(`${row.id}:caption`, row.item.caption, width * 0.8, false, epoch) + 8
          : 0)
      )
    case 'video':
      return (
        180 +
        (row.item.caption
          ? textHeight(`${row.id}:caption`, row.item.caption, width * 0.8, false, epoch) + 8
          : 0)
      )
    case 'question': {
      let height = 24
      for (const spec of row.item.questions) {
        height += textHeight(`${row.id}:${spec.question}`, spec.question, width * 0.8, false, epoch)
        height += 20 * spec.options.length + 16
      }
      return height
    }
  }
}
