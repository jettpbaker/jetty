export type ImageSize = { width: number; height: number }

function size(width: number, height: number): ImageSize | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined
}

// EXIF orientations 5–8 rotate a quarter turn, so browsers show the image with its sides swapped.
function exifRotated(view: DataView, start: number) {
  if (view.getUint32(start) !== 0x45786966) return false
  const tiff = start + 6
  const little = view.getUint16(tiff) === 0x4949
  const ifd = tiff + view.getUint32(tiff + 4, little)
  const count = view.getUint16(ifd, little)
  for (let entry = ifd + 2; entry < ifd + 2 + count * 12; entry += 12)
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little) >= 5
  return false
}

function jpegSize(view: DataView): ImageSize | undefined {
  let offset = 2
  let rotated = false
  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return undefined
    const marker = view.getUint8(offset + 1)
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xe1) rotated ||= exifRotated(view, offset + 4)
    // SOF0–SOF15, minus DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const width = view.getUint16(offset + 7)
      const height = view.getUint16(offset + 5)
      return rotated ? size(height, width) : size(width, height)
    }
    offset += 2 + view.getUint16(offset + 2)
  }
  return undefined
}

function webpSize(view: DataView, bytes: Uint8Array): ImageSize | undefined {
  const chunk = String.fromCharCode(...bytes.subarray(12, 16))
  if (chunk === 'VP8X')
    return size(
      1 + (view.getUint32(24, true) & 0xffffff),
      1 + (view.getUint32(27, true) & 0xffffff)
    )
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true)
    return size(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))
  }
  if (chunk === 'VP8 ')
    return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
  return undefined
}

export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  if (bytes.byteLength < 30) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    if (view.getUint32(0) === 0x89504e47) return size(view.getUint32(16), view.getUint32(20))
    if (view.getUint16(0) === 0xffd8) return jpegSize(view)
    if (String.fromCharCode(...bytes.subarray(0, 3)) === 'GIF')
      return size(view.getUint16(6, true), view.getUint16(8, true))
    if (
      String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
    )
      return webpSize(view, bytes)
  } catch {
    return undefined
  }
  return undefined
}
