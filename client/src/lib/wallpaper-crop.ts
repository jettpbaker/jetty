const wallpaperLongEdge = 3840
export const wallpaperQuality = 0.92

export function wallpaperPixelSize(width: number, height: number) {
  const scale = Math.min(1, wallpaperLongEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export type WallpaperCrop = { aspect: number; zoom: number; x: number; y: number }
export const defaultCrop: WallpaperCrop = { aspect: 16 / 9, zoom: 1, x: 0.5, y: 0.5 }

export function cropRect(width: number, height: number, crop: WallpaperCrop) {
  const w = Math.min(width, height * crop.aspect) / crop.zoom
  const h = w / crop.aspect
  return { x: (width - w) * crop.x, y: (height - h) * crop.y, width: w, height: h }
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function resizeCrop(
  width: number,
  height: number,
  crop: WallpaperCrop,
  handle: CropHandle,
  dx: number,
  dy: number
): WallpaperCrop {
  const rect = cropRect(width, height, crop)
  const minWidth = width / 10
  const minHeight = height / 10
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minWidth)
  if (handle.includes('e')) right = clamp(right + dx, left + minWidth, width)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minHeight)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minHeight, height)
  const w = right - left
  const h = bottom - top
  const aspect = w / h
  return {
    aspect,
    zoom: Math.max(1, Math.min(width, height * aspect) / w),
    x: width - w > 0.001 ? clamp(left / (width - w), 0, 1) : 0.5,
    y: height - h > 0.001 ? clamp(top / (height - h), 0, 1) : 0.5,
  }
}

export async function renderWallpaperCrop(source: string, crop: WallpaperCrop) {
  const image = new Image()
  image.src = source
  await image.decode()
  const rect = cropRect(image.naturalWidth, image.naturalHeight, crop)
  const fitted = wallpaperPixelSize(rect.width, rect.height)
  const canvas = document.createElement('canvas')
  canvas.width = fitted.width
  canvas.height = fitted.height
  canvas
    .getContext('2d')!
    .drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/webp', wallpaperQuality)
}
