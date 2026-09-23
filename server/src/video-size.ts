import { open } from 'node:fs/promises'

type VideoSize = { width: number; height: number }
type Read = (offset: number, length: number) => Promise<Buffer>
type Box = { type: string; start: number; end: number }

function size(width: number, height: number): VideoSize | undefined {
  width = Math.round(width)
  height = Math.round(height)
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? { width, height }
    : undefined
}

export async function videoSize(path: string): Promise<VideoSize | undefined> {
  try {
    const file = await open(path, 'r')
    try {
      const { size: length } = await file.stat()
      let remaining = 4 * 1024 * 1024
      let reads = 16384
      async function read(offset: number, count: number) {
        if (count > remaining || --reads < 0 || offset < 0 || offset + count > length)
          throw new Error('Video header scan limit')
        remaining -= count
        const bytes = Buffer.alloc(count)
        let filled = 0
        while (filled < count) {
          const { bytesRead } = await file.read(bytes, filled, count - filled, offset + filled)
          if (!bytesRead) throw new Error('Truncated video header')
          filled += bytesRead
        }
        return bytes
      }
      const magic = await read(0, 4)
      return magic.readUInt32BE() === 0x1a45dfa3
        ? await webmSize(read, length)
        : await mp4Size(read, length)
    } finally {
      await file.close()
    }
  } catch {
    return undefined
  }
}

async function* boxes(read: Read, start: number, end: number): AsyncGenerator<Box> {
  while (start < end) {
    if (end - start < 8) throw new Error('Truncated MP4 box')
    const header = await read(start, 8)
    let length = header.readUInt32BE()
    let headerSize = 8
    if (length === 1) {
      if (end - start < 16) throw new Error('Truncated MP4 box')
      length = Number((await read(start + 8, 8)).readBigUInt64BE())
      headerSize = 16
    } else if (length === 0) length = end - start
    if (!Number.isSafeInteger(length) || length < headerSize || length > end - start)
      throw new Error('Invalid MP4 box size')
    yield { type: header.toString('ascii', 4, 8), start: start + headerSize, end: start + length }
    start += length
  }
}

async function child(read: Read, parent: Box, type: string) {
  for await (const box of boxes(read, parent.start, parent.end)) {
    if (box.type === type) return box
  }
  return undefined
}

async function mp4Size(read: Read, length: number): Promise<VideoSize | undefined> {
  const moov = await child(read, { type: '', start: 0, end: length }, 'moov')
  if (!moov) return undefined
  for await (const track of boxes(read, moov.start, moov.end)) {
    if (track.type !== 'trak') continue
    const media = await child(read, track, 'mdia')
    const handler = media && (await child(read, media, 'hdlr'))
    if (!handler || handler.end - handler.start < 12) continue
    if ((await read(handler.start + 8, 4)).toString('ascii') !== 'vide') continue
    const header = await child(read, track, 'tkhd')
    let dimensions: VideoSize | undefined
    let rotated = false
    if (header && header.end - header.start >= 84) {
      const version = (await read(header.start, 1))[0]
      const matrixOffset = version === 0 ? 40 : version === 1 ? 52 : undefined
      if (matrixOffset !== undefined && header.end - header.start >= matrixOffset + 44) {
        const bytes = await read(header.start + matrixOffset, 44)
        rotated =
          bytes.readInt32BE(0) === 0 &&
          bytes.readInt32BE(16) === 0 &&
          bytes.readInt32BE(4) !== 0 &&
          bytes.readInt32BE(12) !== 0
        dimensions = size(bytes.readUInt32BE(36) / 65536, bytes.readUInt32BE(40) / 65536)
      }
    }
    if (!dimensions && media) {
      const minf = await child(read, media, 'minf')
      const stbl = minf && (await child(read, minf, 'stbl'))
      const stsd = stbl && (await child(read, stbl, 'stsd'))
      if (stsd && stsd.end - stsd.start >= 8) {
        const count = (await read(stsd.start + 4, 4)).readUInt32BE()
        let index = 0
        for await (const entry of boxes(read, stsd.start + 8, stsd.end)) {
          if (index++ >= count) break
          if (entry.end - entry.start < 78) continue
          const bytes = await read(entry.start + 24, 4)
          dimensions = size(bytes.readUInt16BE(0), bytes.readUInt16BE(2))
          if (dimensions) break
        }
      }
    }
    if (dimensions)
      return rotated ? { width: dimensions.height, height: dimensions.width } : dimensions
  }
  return undefined
}

type Element = { id: number; start: number; end: number }

async function vint(read: Read, offset: number, end: number, id: boolean) {
  if (offset >= end) throw new Error('Truncated EBML integer')
  const first = (await read(offset, 1))[0]!
  let mask = 0x80
  let length = 1
  while (mask && !(first & mask)) {
    mask >>= 1
    length++
  }
  if (length > (id ? 4 : 8) || offset + length > end) throw new Error('Invalid EBML integer')
  const bytes = await read(offset, length)
  let value = BigInt(id ? first : first & (mask - 1))
  for (const byte of bytes.subarray(1)) value = (value << 8n) | BigInt(byte)
  const unknown = !id && value === (1n << BigInt(7 * length)) - 1n
  if (!unknown && value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('EBML integer overflow')
  return { length, value: Number(value), unknown }
}

async function* elements(read: Read, start: number, end: number): AsyncGenerator<Element> {
  while (start < end) {
    const id = await vint(read, start, end, true)
    const length = await vint(read, start + id.length, end, false)
    start += id.length + length.length
    // Streaming WebM commonly leaves Segment's size unknown. Other unknown sizes stop the scan.
    if (length.unknown && id.value !== 0x18538067) return
    const next = length.unknown ? end : start + length.value
    if (next > end) throw new Error('Truncated EBML element')
    yield { id: id.value, start, end: next }
    start = next
  }
}

async function uint(read: Read, element: Element) {
  const length = element.end - element.start
  if (length < 1 || length > 8) throw new Error('Invalid EBML unsigned integer')
  let value = 0n
  for (const byte of await read(element.start, length)) value = (value << 8n) | BigInt(byte)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('EBML integer overflow')
  return Number(value)
}

async function webmVideoSize(read: Read, video: Element) {
  const values = new Map<number, number>()
  for await (const element of elements(read, video.start, video.end)) {
    if ([0xb0, 0xba, 0x54b0, 0x54ba, 0x54b2].includes(element.id))
      values.set(element.id, await uint(read, element))
  }
  const pixels = size(values.get(0xb0) ?? 0, values.get(0xba) ?? 0)
  if (!pixels) return undefined
  const unit = values.get(0x54b2) ?? 0
  const width = values.get(0x54b0)
  const height = values.get(0x54ba)
  if (unit === 0) return size(width ?? pixels.width, height ?? pixels.height)
  if (unit <= 3 && width && height) return size((pixels.height * width) / height, pixels.height)
  return pixels
}

async function webmSize(read: Read, length: number): Promise<VideoSize | undefined> {
  for await (const segment of elements(read, 0, length)) {
    if (segment.id !== 0x18538067) continue
    for await (const tracks of elements(read, segment.start, segment.end)) {
      if (tracks.id !== 0x1654ae6b) continue
      for await (const track of elements(read, tracks.start, tracks.end)) {
        if (track.id !== 0xae) continue
        let trackType: number | undefined
        let video: Element | undefined
        for await (const element of elements(read, track.start, track.end)) {
          if (element.id === 0x83) trackType = await uint(read, element)
          if (element.id === 0xe0) video = element
        }
        if (trackType === 1 && video) {
          const dimensions = await webmVideoSize(read, video)
          if (dimensions) return dimensions
        }
      }
    }
  }
  return undefined
}
