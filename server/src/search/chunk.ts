import { basename } from 'node:path'

export const CHUNK_MIN = 300
export const CHUNK_MAX = 800

export type Chunk = {
  startLine: number
  endLine: number
  text: string
  title: string
  context: string
}

type Span = { startLine: number; endLine: number; text: string }

type Para = Span & { heading: string | null }

type Frontmatter = {
  /** 1-based line of the closing ---, or 0 when there is none. Content starts at index closeLine. */
  closeLine: number
  tags: string[]
  updated: string | null
}

export function chunkFile(relPath: string, content: string): Chunk[] {
  const lines = splitLines(content)
  const frontmatter = parseFrontmatter(lines)
  const title = sanitizeTitle(documentTitle(relPath, lines))
  const context = contextFor(frontmatter.tags, frontmatter.updated)
  if (relPath === 'index.md') return chunkIndex(lines, frontmatter.closeLine, context, title)
  const spans = relPath.startsWith('log/')
    ? chunkLog(lines, frontmatter.closeLine)
    : relPath.endsWith('.md')
      ? chunkProse(lines, frontmatter.closeLine)
      : chunkPackedLines(lines, frontmatter.closeLine)
  return spans
    .filter((span) => span.text.trim().length > 0)
    .map((span) => ({ ...span, title, context }))
}

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function parseFrontmatter(lines: string[]): Frontmatter {
  if ((lines[0]! ?? '').trim() !== '---') return { closeLine: 0, tags: [], updated: null }
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      close = i
      break
    }
  }
  if (close === -1) return { closeLine: 0, tags: [], updated: null }
  const raw = lines.slice(1, close).join('\n')
  const tagLine = raw.match(/^tags:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const inner = tagLine.startsWith('[')
    ? tagLine.slice(1, tagLine.endsWith(']') ? -1 : undefined)
    : tagLine
  const tags = inner
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  const updated = raw.match(/^updated:\s*(.+)$/m)?.[1]?.trim() ?? null
  return { closeLine: close + 1, tags, updated }
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line)
}

function headingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').trim()
}

function documentTitle(relPath: string, lines: string[]): string {
  if (relPath.startsWith('log/')) return `log ${basename(relPath, '.md')}`
  for (const line of lines) {
    if (/^#\s+\S/.test(line)) return headingText(line)
  }
  return basename(relPath)
}

function sanitizeTitle(title: string): string {
  const clean = title
    .replace(/[\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean || 'none'
}

function contextFor(tags: string[], updated: string | null): string {
  const parts: string[] = []
  if (tags.length > 0) parts.push(`Tags: ${tags.join(', ')}`)
  if (updated) parts.push(`Updated: ${updated}`)
  return parts.join('\n')
}

function sliceText(lines: string[], start: number, end: number): string {
  return lines
    .slice(start - 1, end)
    .join('\n')
    .replace(/\s+$/g, '')
}

function chunkLog(lines: string[], closeLine: number): Span[] {
  const spans: Span[] = []
  let start = 0
  let end = 0
  let open = false
  const flush = () => {
    if (!open) return
    const text = sliceText(lines, start, end)
    if (text.trim()) spans.push({ startLine: start, endLine: end, text })
    open = false
  }
  for (let i = closeLine; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i]!
    if (line.trim() === '' || isHeading(line)) {
      flush()
      continue
    }
    const bullet = /^\s*[-*]\s+\S/.test(line)
    const indented = /^\s+\S/.test(line)
    if (open && indented && !bullet) {
      end = lineNo
      continue
    }
    flush()
    start = lineNo
    end = lineNo
    open = true
  }
  flush()
  return spans
}

function chunkIndex(
  lines: string[],
  closeLine: number,
  fileContext: string,
  title: string
): Chunk[] {
  const chunks: Chunk[] = []
  let group = ''
  for (let i = closeLine; i < lines.length; i++) {
    const line = lines[i]!
    if (isHeading(line)) {
      if (!line.startsWith('# ')) group = headingText(line)
      continue
    }
    if (!/^\s*[-*]\s+\S/.test(line)) continue
    const context = [fileContext, group ? `Section: ${group}` : ''].filter(Boolean).join('\n')
    chunks.push({ startLine: i + 1, endLine: i + 1, text: line.trim(), title, context })
  }
  return chunks
}

function paragraphs(lines: string[], closeLine: number): Para[] {
  const paras: Para[] = []
  let heading: string | null = null
  let pendingHeadingLine: number | null = null
  let bufStart = 0
  let bufEnd = 0
  let hasBuf = false

  const flush = () => {
    if (!hasBuf) return
    const start = pendingHeadingLine ?? bufStart
    const text = sliceText(lines, start, bufEnd)
    if (text.trim()) paras.push({ startLine: start, endLine: bufEnd, text, heading })
    pendingHeadingLine = null
    hasBuf = false
  }

  for (let i = closeLine; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i]!
    if (isHeading(line)) {
      flush()
      heading = headingText(line)
      pendingHeadingLine = lineNo
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    if (!hasBuf) {
      bufStart = lineNo
      hasBuf = true
    }
    bufEnd = lineNo
  }
  flush()
  if (pendingHeadingLine !== null) {
    paras.push({
      startLine: pendingHeadingLine,
      endLine: pendingHeadingLine,
      text: lines[pendingHeadingLine - 1]!,
      heading,
    })
  }
  return paras
}

function chunkProse(lines: string[], closeLine: number): Span[] {
  const paras = paragraphs(lines, closeLine)
  const spans: Span[] = []
  let buf: Para[] = []

  const lengthOf = () =>
    buf.length === 0 ? 0 : sliceText(lines, buf[0]!.startLine, buf[buf.length - 1]!.endLine).length

  const flush = () => {
    if (buf.length === 0) return
    const text = sliceText(lines, buf[0]!.startLine, buf[buf.length - 1]!.endLine)
    if (text.trim())
      spans.push({ startLine: buf[0]!.startLine, endLine: buf[buf.length - 1]!.endLine, text })
    buf = []
  }

  for (const para of paras) {
    const sameHeading = buf.length === 0 || buf[buf.length - 1]!.heading === para.heading
    if (!sameHeading && lengthOf() >= CHUNK_MIN) flush()
    if (para.text.length > CHUNK_MAX) {
      flush()
      spans.push(...splitByLines(lines, para.startLine, para.endLine))
      continue
    }
    if (buf.length > 0 && lengthOf() >= CHUNK_MIN && lengthOf() + 2 + para.text.length > CHUNK_MAX)
      flush()
    buf.push(para)
    if (lengthOf() >= CHUNK_MAX) flush()
  }
  flush()
  return spans
}

function splitByLines(lines: string[], start: number, end: number): Span[] {
  const spans: Span[] = []
  let chunkStart = start
  let len = 0
  const flush = (chunkEnd: number) => {
    if (chunkEnd < chunkStart) return
    const text = sliceText(lines, chunkStart, chunkEnd)
    if (!text) return
    if (text.length <= CHUNK_MAX) {
      spans.push({ startLine: chunkStart, endLine: chunkEnd, text })
      return
    }
    if (chunkStart === chunkEnd) {
      spans.push(...hardSplit(chunkStart, text))
      return
    }
    const mid = Math.floor((chunkStart + chunkEnd) / 2)
    spans.push(...splitByLines(lines, chunkStart, mid), ...splitByLines(lines, mid + 1, chunkEnd))
  }
  for (let lineNo = start; lineNo <= end; lineNo++) {
    const add = lines[lineNo - 1]!.length + 1
    if (len >= CHUNK_MIN && len + add > CHUNK_MAX && lineNo > chunkStart) {
      flush(lineNo - 1)
      chunkStart = lineNo
      len = 0
    }
    len += add
  }
  flush(end)
  return spans
}

function hardSplit(lineNo: number, text: string): Span[] {
  const parts = text.split(/(?<=[.!?])\s+/)
  const spans: Span[] = []
  let buf = ''
  const push = () => {
    const trimmed = buf.trim()
    if (!trimmed) return
    if (trimmed.length <= CHUNK_MAX)
      spans.push({ startLine: lineNo, endLine: lineNo, text: trimmed })
    else {
      for (let i = 0; i < trimmed.length; i += CHUNK_MAX) {
        spans.push({ startLine: lineNo, endLine: lineNo, text: trimmed.slice(i, i + CHUNK_MAX) })
      }
    }
    buf = ''
  }
  for (const part of parts) {
    const piece = buf ? `${buf} ${part}` : part
    if (buf.length >= CHUNK_MIN && piece.length > CHUNK_MAX) push()
    buf = buf ? `${buf} ${part}` : part
    if (buf.length >= CHUNK_MAX) push()
  }
  push()
  return spans
}

function chunkPackedLines(lines: string[], closeLine: number): Span[] {
  const content: { lineNo: number; text: string }[] = []
  for (let i = closeLine; i < lines.length; i++) {
    if (lines[i]!.trim() === '') continue
    content.push({ lineNo: i + 1, text: lines[i]!.trimEnd() })
  }
  if (content.length === 0) return []
  const spans: Span[] = []
  let start = 0
  let len = 0
  const flushTo = (exclusive: number) => {
    if (exclusive <= start) return
    const slice = content.slice(start, exclusive)
    const text = slice.map((line) => line.text).join('\n')
    if (text.length > CHUNK_MAX && slice.length === 1) {
      spans.push(...hardSplit(slice[0]!.lineNo, text))
      return
    }
    spans.push({ startLine: slice[0]!.lineNo, endLine: slice[slice.length - 1]!.lineNo, text })
  }
  for (let i = 0; i < content.length; i++) {
    const add = content[i]!.text.length + 1
    if (len >= CHUNK_MIN && len + add > CHUNK_MAX) {
      flushTo(i)
      start = i
      len = 0
    }
    len += add
  }
  flushTo(content.length)
  return spans
}

export function chunkProseText(text: string) {
  return chunkProse(splitLines(text), 0)
}
