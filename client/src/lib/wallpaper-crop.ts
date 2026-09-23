export type WallpaperCrop = { aspect: number; zoom: number; x: number; y: number }
export const defaultCrop: WallpaperCrop = { aspect: 16 / 9, zoom: 1, x: 0.5, y: 0.5 }
export function cropRect(width: number, height: number, crop: WallpaperCrop) {
  const w = Math.min(width, height * crop.aspect) / crop.zoom
  const h = w / crop.aspect
  return { x: (width - w) * crop.x, y: (height - h) * crop.y, width: w, height: h }
}
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export function resizeCrop(
  width: number,
  height: number,
  crop: WallpaperCrop,
  handle: CropHandle,
  dx: number,
  dy: number
): WallpaperCrop {
  const rect = cropRect(width, height, crop)
  const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  const minWidth = width / 10
  const minHeight = height / 10
  let left = rect.x,
    top = rect.y,
    right = rect.x + rect.width,
    bottom = rect.y + rect.height
  if (handle.includes('w')) left = bound(left + dx, 0, right - minWidth)
  if (handle.includes('e')) right = bound(right + dx, left + minWidth, width)
  if (handle.includes('n')) top = bound(top + dy, 0, bottom - minHeight)
  if (handle.includes('s')) bottom = bound(bottom + dy, top + minHeight, height)
  const w = right - left
  const h = bottom - top
  const aspect = w / h
  return {
    aspect,
    zoom: Math.max(1, Math.min(width, height * aspect) / w),
    x: width - w > 0.001 ? bound(left / (width - w), 0, 1) : 0.5,
    y: height - h > 0.001 ? bound(top / (height - h), 0, 1) : 0.5,
  }
}
export async function renderWallpaperCrop(source: string, crop: WallpaperCrop) {
  const image = new Image()
  image.src = source
  await image.decode()
  const rect = cropRect(image.naturalWidth, image.naturalHeight, crop)
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 1920 / Math.max(rect.width, rect.height))
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not crop this image.')
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/webp', 0.9)
}
