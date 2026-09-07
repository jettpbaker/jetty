type ByteRange = { start: number; end: number }

export function rangeResponse(
  file: Bun.BunFile,
  mimeType: string,
  rangeHeader: string | null
): Response {
  const size = file.size
  const parsed = parseBytesRange(rangeHeader, size)
  if (parsed === 'full') {
    return new Response(file, {
      headers: {
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size),
      },
    })
  }
  if (parsed === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${size}`,
      },
    })
  }
  const { start, end } = parsed
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    },
  })
}

function parseBytesRange(
  header: string | null,
  size: number
): ByteRange | 'full' | 'unsatisfiable' {
  if (!header) return 'full'
  // single `bytes=start-end` only; suffix (`bytes=-N`) and multi-range are unsupported → full file
  const match = /^bytes=(\d+)-(\d+)?$/.exec(header.trim())
  if (!match) return 'full'
  const start = Number(match[1])
  const end = match[2] !== undefined ? Number(match[2]) : size - 1
  if (size === 0 || start >= size || end < start) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}
