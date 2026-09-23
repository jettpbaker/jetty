import type { ThreadItem } from '@jetty/shared/items'

import { layout, prepare, type PreparedText } from '@chenglou/pretext'

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

export function estimateItem(item: ThreadItem, columnWidth: number, epoch: number) {
  const width = Math.max(1, columnWidth)
  switch (item.kind) {
    case 'user_message':
      return (
        textHeight(item.id, item.text, width * 0.8, true, epoch) +
        16 +
        (item.attachments.length ? 72 : 0)
      )
    case 'assistant_message':
    case 'plan':
      return textHeight(item.id, item.text, width, false, epoch) + 8
    case 'reasoning':
      return textHeight(item.id, item.text, width, true, epoch) + 28
    case 'error':
      return textHeight(item.id, item.message, width, true, epoch) + 16
    default:
      return 36
  }
}
