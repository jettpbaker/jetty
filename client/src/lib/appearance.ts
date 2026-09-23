import { blobs, storage } from '@/platform'
import { useEffect, useState } from 'react'

import { loadAccent, setAccent } from './accent'
import { applyWallpaperAccent } from './wallpaper-accent'
import { wallpaperPixelSize, wallpaperQuality, type WallpaperCrop } from './wallpaper-crop'

export const defaultWallpaperSrc = '/backgrounds/dither_test.jpeg'
export type Appearance = {
  wallpaper: string
  filename: string | null
  autoAccent: boolean
  source?: string
  crop?: WallpaperCrop
}

const defaults: Appearance = { wallpaper: '', filename: null, autoAccent: false }
const key = 'jetty.appearance'
const wallpaperBlob = 'wallpaper'
const sourceBlob = 'wallpaper-source'
const eventName = 'jetty-appearance'
const dataUrl = /^data:image\/(jpeg|png|webp);base64,/

type WallpaperRef = '' | 'opfs' | typeof defaultWallpaperSrc

type StoredAppearance = {
  autoAccent: boolean
  filename: string | null
  wallpaper: WallpaperRef
  source?: 'opfs'
  crop?: WallpaperCrop
  legacyWallpaper?: string
  legacySource?: string
}

let cache: Appearance | undefined
let liveUrls: string[] = []
let pending: Promise<void> = Promise.resolve()

function cropOf(value: unknown): WallpaperCrop | undefined {
  if (!value || typeof value !== 'object') return undefined
  const crop = value as WallpaperCrop
  if (
    [crop.aspect, crop.zoom, crop.x, crop.y].every(Number.isFinite) &&
    crop.aspect > 0 &&
    crop.zoom >= 1 &&
    crop.zoom <= 10.001 &&
    crop.x >= 0 &&
    crop.x <= 1 &&
    crop.y >= 0 &&
    crop.y <= 1
  )
    return crop
  return undefined
}

function readStored(): StoredAppearance {
  const empty: StoredAppearance = { autoAccent: false, filename: null, wallpaper: '' }
  try {
    const data = JSON.parse(storage.get(key) ?? 'null')
    if (!data || typeof data.autoAccent !== 'boolean') return empty
    const filename = typeof data.filename === 'string' ? data.filename : null
    const crop = cropOf(data.crop)
    if (data.wallpaper === 'opfs' || data.wallpaper === defaultWallpaperSrc) {
      return {
        autoAccent: data.autoAccent,
        filename,
        wallpaper: data.wallpaper,
        source: data.source === 'opfs' ? 'opfs' : undefined,
        crop,
      }
    }
    if (typeof data.wallpaper === 'string' && dataUrl.test(data.wallpaper)) {
      return {
        autoAccent: Boolean(data.autoAccent),
        filename,
        wallpaper: '',
        crop,
        legacyWallpaper: data.wallpaper,
        legacySource:
          typeof data.source === 'string' && dataUrl.test(data.source) ? data.source : undefined,
      }
    }
    return empty
  } catch {
    return empty
  }
}

function writeStored(stored: StoredAppearance) {
  storage.set(
    key,
    JSON.stringify({
      autoAccent: stored.autoAccent,
      filename: stored.filename,
      wallpaper: stored.wallpaper,
      source: stored.source,
      crop: stored.crop,
    })
  )
}

async function dataUrlToBlob(value: string) {
  return await (await fetch(value)).blob()
}

async function objectUrl(name: string) {
  const blob = await blobs.get(name)
  if (!blob) return ''
  const url = URL.createObjectURL(blob)
  liveUrls.push(url)
  return url
}

async function materialize(stored: StoredAppearance): Promise<Appearance> {
  const previous = liveUrls
  liveUrls = []
  const wallpaper =
    stored.wallpaper === 'opfs'
      ? await objectUrl(wallpaperBlob)
      : stored.wallpaper === defaultWallpaperSrc
        ? defaultWallpaperSrc
        : ''
  const source = stored.source === 'opfs' ? (await objectUrl(sourceBlob)) || undefined : undefined
  requestAnimationFrame(() => {
    for (const url of previous) URL.revokeObjectURL(url)
  })
  return {
    wallpaper,
    filename: wallpaper ? stored.filename : null,
    autoAccent: Boolean(wallpaper && stored.autoAccent),
    source,
    crop: wallpaper ? stored.crop : undefined,
  }
}

function publish(next: Appearance) {
  cache = next
  window.dispatchEvent(new Event(eventName))
  syncAppearanceAccent()
}

async function migrate(stored: StoredAppearance) {
  if (!stored.legacyWallpaper) return stored
  await blobs.put(wallpaperBlob, await dataUrlToBlob(stored.legacyWallpaper))
  if (stored.legacySource) await blobs.put(sourceBlob, await dataUrlToBlob(stored.legacySource))
  else await blobs.remove(sourceBlob)
  const next: StoredAppearance = {
    autoAccent: stored.autoAccent,
    filename: stored.filename,
    wallpaper: 'opfs',
    source: stored.legacySource ? 'opfs' : undefined,
    crop: stored.crop,
  }
  writeStored(next)
  return next
}

function enqueue(work: () => Promise<void>) {
  const run = pending.then(work)
  pending = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function loadAppearance(): Appearance {
  return cache ?? defaults
}

let generation = 0
export function syncAppearanceAccent() {
  const current = ++generation
  const prefs = loadAppearance()
  if (!prefs.autoAccent || !prefs.wallpaper) {
    setAccent(loadAccent())
    return
  }
  const image = new Image()
  image.onload = () => {
    if (current === generation && !applyWallpaperAccent(image)) setAccent(loadAccent())
  }
  image.onerror = () => {
    if (current === generation) setAccent(loadAccent())
  }
  image.src = prefs.wallpaper
}

export function hydrateAppearance() {
  return enqueue(async () => {
    const stored = await migrate(readStored())
    publish(await materialize(stored))
  })
}

export function saveAppearance(next: Appearance) {
  return enqueue(async () => {
    const stored = await migrate(readStored())
    if (!next.wallpaper) {
      await blobs.remove(wallpaperBlob)
      await blobs.remove(sourceBlob)
      const cleared: StoredAppearance = { autoAccent: false, filename: null, wallpaper: '' }
      writeStored(cleared)
      publish(await materialize(cleared))
      return
    }
    if (dataUrl.test(next.wallpaper)) {
      if (next.source && dataUrl.test(next.source)) {
        await blobs.put(sourceBlob, await dataUrlToBlob(next.source))
        stored.source = 'opfs'
      } else if (!next.source) {
        await blobs.remove(sourceBlob)
        stored.source = undefined
      } else if (stored.source !== 'opfs') {
        const current = await blobs.get(wallpaperBlob)
        if (current) {
          await blobs.put(sourceBlob, current)
          stored.source = 'opfs'
        }
      }
      await blobs.put(wallpaperBlob, await dataUrlToBlob(next.wallpaper))
      stored.wallpaper = 'opfs'
      stored.filename = next.filename
      stored.crop = next.crop
    } else if (next.wallpaper === defaultWallpaperSrc) {
      stored.wallpaper = defaultWallpaperSrc
      stored.filename = next.filename
      stored.crop = next.crop
    } else {
      stored.filename = next.filename
      stored.crop = next.crop
    }
    stored.autoAccent = next.autoAccent
    writeStored(stored)
    publish(await materialize(stored))
  })
}

export function useAppearance() {
  const [appearance, setAppearance] = useState(loadAppearance)
  useEffect(() => {
    const sync = () => setAppearance(loadAppearance())
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) void hydrateAppearance()
    }
    void hydrateAppearance()
    window.addEventListener(eventName, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(eventName, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return appearance
}

// Above this, decoding the bitmap can freeze the tab. File size is not the limit.
const maxDecodedPixels = 120_000_000

function readU32(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  )
}

function positiveSize(width: number, height: number) {
  if (width > 0 && height > 0) return { width, height }
  return undefined
}

function pngSize(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 24) return undefined
  for (let index = 0; index < signature.length; index += 1)
    if (bytes[index] !== signature[index]) return undefined
  if (bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return undefined
  return positiveSize(readU32(bytes, 16) >>> 0, readU32(bytes, 20) >>> 0)
}

function jpegSize(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return undefined
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
    if (length < 2 || offset + length > bytes.length) return undefined
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      if (length < 7) return undefined
      return positiveSize(
        ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0)
      )
    }
    offset += length
  }
  return undefined
}

function webpSize(bytes: Uint8Array) {
  if (
    bytes.length < 30 ||
    bytes[0] !== 82 ||
    bytes[1] !== 73 ||
    bytes[2] !== 70 ||
    bytes[3] !== 70 ||
    bytes[8] !== 87 ||
    bytes[9] !== 69 ||
    bytes[10] !== 66 ||
    bytes[11] !== 80
  )
    return undefined
  const kind = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0)
  if (kind === 'VP8X') {
    return positiveSize(
      1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)),
      1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16))
    )
  }
  if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return positiveSize(
      ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff,
      ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff
    )
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits =
      (bytes[21] ?? 0) |
      ((bytes[22] ?? 0) << 8) |
      ((bytes[23] ?? 0) << 16) |
      ((bytes[24] ?? 0) << 24)
    return positiveSize((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  return undefined
}

function imageSize(bytes: Uint8Array, type: string) {
  if (type === 'image/png') return pngSize(bytes)
  if (type === 'image/jpeg') return jpegSize(bytes)
  if (type === 'image/webp') return webpSize(bytes)
  return undefined
}

// The returned data URL is the compressed WebP. saveAppearance stores those bytes, not the file.
export async function prepareWallpaper(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPG, PNG, or WebP image.')
  const size = imageSize(new Uint8Array(await file.arrayBuffer()), file.type)
  if (!size) throw new Error('This image could not be opened. Try another one.')
  if (size.width * size.height > maxDecodedPixels)
    throw new Error('This image is too large to open.')
  const fitted = wallpaperPixelSize(size.width, size.height)
  try {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: fitted.width,
      resizeHeight: fitted.height,
      resizeQuality: 'high',
    })
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This image could not be processed. Try another one.')
      context.drawImage(bitmap, 0, 0)
      return canvas.toDataURL('image/webp', wallpaperQuality)
    } finally {
      bitmap.close()
    }
  } catch (error) {
    if (error instanceof Error && !(error instanceof DOMException)) throw error
    throw new Error('This image could not be opened. Try another one.')
  }
}
