import { layout, prepare, type PreparedText } from '@chenglou/pretext'

import type { ThreadRow } from './thread_rows'

import { isImageAttachment } from './attachment_files'
import { botMarkerHeight, markerRuns, reportRuns } from './bot_marker_model'
import {
  BUBBLE_THUMBNAIL_SIZE,
  fittedSize,
  frameHeight,
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

const lineHeight = 13 * 1.625
// The footer under a message, and the bubble's gap above it.
const footerRow = 28
// A quote above the message's bubble, before the content gap.
const quoteRow = 26
// A file above the message's bubble, before the content gap.
const fileRow = 26
// Geist's mean advance at 14px, for rough line counts that skip text layout.
const charWidth = 6.5
type Measured = {
  text: string
  prepared?: PreparedText
  width?: number
  lineHeight?: number
  fontSize?: number
  height: number
}
const cache = new Map<string, Measured>()
// Prepared text (about 20 bytes a character) only serves laying it out again at a new width, so past
// this many characters the least recently used give theirs up.
const preparedBudget = 1_000_000
const preparedRecent = new Map<string, Measured>()
let preparedChars = 0

export function clearTextMeasure() {
  cache.clear()
  preparedRecent.clear()
  preparedChars = 0
  collapsibleTexts.clear()
}

function keepPrepared(id: string, entry: Measured) {
  const previous = preparedRecent.get(id)
  if (previous) preparedChars -= previous.text.length
  preparedRecent.delete(id)
  preparedRecent.set(id, entry)
  preparedChars += entry.text.length
  if (preparedChars <= preparedBudget) return
  for (const [oldest, measured] of preparedRecent) {
    if (preparedChars <= preparedBudget) break
    preparedRecent.delete(oldest)
    preparedChars -= measured.text.length
    measured.prepared = undefined
  }
}

function roughHeight(
  text: string,
  width: number,
  preWrap: boolean,
  leading: number,
  fontSize: number
) {
  const perLine = Math.max(1, Math.floor(width / ((charWidth * fontSize) / 14)))
  let lines = 0
  for (const line of preWrap ? text.split('\n') : [text])
    lines += Math.max(1, Math.ceil(line.length / perLine))
  return lines * leading
}

function textHeight(
  id: string,
  text: string,
  width: number,
  preWrap: boolean,
  rough: boolean,
  leading = lineHeight,
  fontSize = 13
) {
  if (rough) return roughHeight(text, width, preWrap, leading, fontSize)
  let entry = cache.get(id)
  if (!entry || entry.text !== text || entry.fontSize !== fontSize) {
    entry = { text, fontSize, height: 0 }
    cache.set(id, entry)
  }
  if (entry.width !== width || entry.lineHeight !== leading) {
    entry.prepared ??= prepare(
      text || ' ',
      `${fontSize}px "Geist Variable"`,
      preWrap ? { whiteSpace: 'pre-wrap' } : undefined
    )
    entry.width = width
    entry.lineHeight = leading
    entry.height = layout(entry.prepared, Math.max(1, width), leading).height
  }
  if (entry.prepared) keepPrepared(id, entry)
  return entry.height
}

// An image alone on its line renders as media, which holds a 16:9 frame until its size is read.
const imageLine =
  /^[ \t]*!\[[^\]\n]*\]\([ \t]*<?https?:\/\/[^\s)>]+>?(?:[ \t]+"[^"\n]*")?[ \t]*\)[ \t]*$/gm

function markdownHeight(
  id: string,
  text: string,
  width: number,
  rough: boolean,
  leading = lineHeight,
  fontSize = 13
) {
  if (!text.includes('![')) return textHeight(id, text, width, false, rough, leading, fontSize)
  let media = 0
  const prose = text.replace(imageLine, () => {
    media += frameHeight(width)
    return ''
  })
  return textHeight(id, prose, width, false, rough, leading, fontSize) + media
}

function captionHeight(id: string, caption: string | undefined, width: number, rough: boolean) {
  return caption ? textHeight(`${id}:caption`, caption, width, false, rough, 20) + 8 : 0
}

const estimateSignatures = new WeakMap<ThreadRow, string>()

// What a row's estimate reads, less text still streaming in: on screen that row is measured, and
// off it the estimate catches up when the text finishes.
function estimateSignature(row: ThreadRow) {
  const cached = estimateSignatures.get(row)
  if (cached !== undefined) return cached
  let inputs: unknown
  switch (row.kind) {
    case 'assistant':
    case 'plan':
      inputs = [row.streaming, row.streaming ? undefined : row.item.text, row.footer !== undefined]
      break
    case 'work':
      inputs = workEnded(row.status)
        ? true
        : groupWorkActivities(row.activities, false)
            .slice(-previewCount)
            .map((entry) => [entry.type, entry.id, entry.type === 'text' && entry.text])
      break
    case 'user':
      inputs = [
        row.item.text,
        row.item.skill,
        row.item.attachments,
        !!row.item.from,
        !!row.sourceBot,
        row.item.replies?.length,
      ]
      break
    case 'reports':
      inputs = row.reports.map((report) => report.question)
      break
    case 'error':
      inputs = row.message
      break
    case 'gallery':
      inputs = [row.item.images, row.item.caption]
      break
    case 'video':
      inputs = [row.item.video, row.item.caption]
      break
    case 'wake':
      inputs = [reportRuns(row.reports ?? []).length, !!row.wake]
      break
    case 'markers':
      inputs = markerRuns(row.markers).length
      break
    case 'workflow':
      inputs = [row.item.status, row.item.phases.length, row.item.agents.length]
      break
  }
  const signature = JSON.stringify([row.kind, row.id, inputs])
  estimateSignatures.set(row, signature)
  return signature
}

// Whether any row's estimate can differ between two builds of the rows. Rows that kept their
// identity can't.
export function estimatesChanged(previous: readonly ThreadRow[], rows: readonly ThreadRow[]) {
  if (previous.length !== rows.length) return true
  for (const [index, row] of rows.entries())
    if (rowEstimateChanged(previous[index]!, row)) return true
  return false
}

export function rowEstimateChanged(previous: ThreadRow, row: ThreadRow) {
  return previous !== row && estimateSignature(previous) !== estimateSignature(row)
}

// Rough estimates count lines from text length instead of laying the text out.
export function estimateRow(row: ThreadRow, width: number, rough = false) {
  switch (row.kind) {
    case 'subagentDone':
      return lineHeight + 6
    case 'reports': {
      let height = 2 + (lineHeight + 4) * row.reports.length
      for (const [index, report] of row.reports.entries())
        if (report.question)
          height += textHeight(`${row.id}:${index}`, report.question, width, true, rough) + 4
      return height
    }
    case 'user': {
      const { text, skill, attachments, from, replies } = row.item
      const images = attachments.some(isImageAttachment)
      const prose = skill ? `/${skill} ${text}` : text
      const full = prose ? textHeight(row.id, prose, width * 0.8 - 22, true, rough) : 0
      let height =
        12 +
        (prose || images ? 14 + footerRow : 24) +
        (full > collapseAfterHeight
          ? (expandedMessages.has(row.item.id) ? full : collapsedTextHeight) + 28
          : full)
      const gap = from ? (row.sourceBot ? 4 : 6) : replies ? 3 : 10
      if (from) height += 16 + gap
      height += (quoteRow + gap) * (replies?.length ?? 0)
      if (images) height += BUBBLE_THUMBNAIL_SIZE + (prose ? 8 : 0)
      const files = attachments.filter((attachment) => !isImageAttachment(attachment)).length
      if (files) height += fileRow * files + 4 * (files - 1) + gap
      return height
    }
    case 'assistant':
    case 'plan':
      // A streaming reply would be laid out again on every delta; it's measured once on screen.
      return (
        markdownHeight(row.id, row.item.text, width, rough || row.streaming, 13 * 1.625, 13) +
        2 +
        (row.kind === 'plan' ? 20 : 0) +
        (row.footer === undefined ? 4 : footerRow)
      )
    case 'work': {
      if (workEnded(row.status)) return 28
      let height = 32
      for (const entry of groupWorkActivities(row.activities, false).slice(-previewCount)) {
        height +=
          entry.type === 'text'
            ? markdownHeight(entry.id, entry.text, width - 8, rough, 20, 13) + 8
            : 28
      }
      return height
    }
    case 'error':
      return textHeight(row.id, row.message, width, false, rough, 20)
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
    case 'workflow':
      return row.item.status === 'running'
        ? 74 +
            28 * row.item.phases.length +
            Math.max(0, row.item.phases.length - 1) * 4 +
            28 * row.item.agents.length
        : 38
    case 'wake':
      return botMarkerHeight(reportRuns(row.reports ?? []).length + Number(!!row.wake))
    case 'markers':
      return botMarkerHeight(markerRuns(row.markers).length)
    case 'exchange':
    case 'tidying':
    case 'pullRequest':
    case 'pullRequestGroup':
      return 20
    case 'compaction':
    case 'restart':
    case 'backgroundStopped':
    case 'background':
    case 'restartLimit':
      return 24
  }
}
