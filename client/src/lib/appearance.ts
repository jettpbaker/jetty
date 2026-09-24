import { blobs, storage } from '@/platform'
import { useEffect, useState } from 'react'

import { loadAccent, setAccent } from './accent'
import { applyWallpaperAccent } from './wallpaper-accent'
import { wallpaperPixelSize, wallpaperQuality, type WallpaperCrop } from './wallpaper-crop'

export type Appearance = {
  wallpaper: string
  filename: string | null
  autoAccent: boolean
  source?: string
  crop?: WallpaperCrop
  video: string
  videoFilename: string | null
}

const defaults: Appearance = {
  wallpaper: '',
  filename: null,
  autoAccent: false,
  video: '',
  videoFilename: null,
}
const key = 'jetty.appearance'
const wallpaperBlob = 'wallpaper'
const sourceBlob = 'wallpaper-source'
const videoBlob = 'wallpaper-video'
const eventName = 'jetty-appearance'
const dataUrl = /^data:image\/(jpeg|png|webp);base64,/

type StoredAppearance = {
  autoAccent: boolean
  filename: string | null
  wallpaper: '' | 'opfs'
  source?: 'opfs'
  crop?: WallpaperCrop
  video?: 'opfs'
  videoFilename?: string | null
}

let cache: Appearance | undefined
const urls = new Map<string, string>()
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
    const video: Pick<StoredAppearance, 'video' | 'videoFilename'> =
      data.video === 'opfs'
        ? {
            video: 'opfs',
            videoFilename: typeof data.videoFilename === 'string' ? data.videoFilename : null,
          }
        : {}
    if (data.wallpaper === 'opfs') {
      return {
        autoAccent: data.autoAccent,
        filename: typeof data.filename === 'string' ? data.filename : null,
        wallpaper: 'opfs',
        source: data.source === 'opfs' ? 'opfs' : undefined,
        crop: cropOf(data.crop),
        ...video,
      }
    }
    return { ...empty, ...video }
  } catch {
    return empty
  }
}

function writeStored({
  autoAccent,
  filename,
  wallpaper,
  source,
  crop,
  video,
  videoFilename,
}: StoredAppearance) {
  storage.set(
    key,
    JSON.stringify({ autoAccent, filename, wallpaper, source, crop, video, videoFilename })
  )
}

async function dataUrlToBlob(value: string) {
  return await (await fetch(value)).blob()
}

// One URL per stored blob, kept until that blob changes: a fresh URL makes an <img> or <video> reload.
async function objectUrl(name: string) {
  let url = urls.get(name)
  if (url === undefined) {
    const blob = await blobs.get(name)
    url = blob ? URL.createObjectURL(blob) : ''
    urls.set(name, url)
  }
  return url
}

function forget(...names: string[]) {
  for (const name of names) {
    const url = urls.get(name)
    urls.delete(name)
    if (url) requestAnimationFrame(() => URL.revokeObjectURL(url))
  }
}

async function materialize(stored: StoredAppearance): Promise<Appearance> {
  const wallpaper = stored.wallpaper === 'opfs' ? await objectUrl(wallpaperBlob) : ''
  const source = stored.source === 'opfs' ? (await objectUrl(sourceBlob)) || undefined : undefined
  const video = stored.video === 'opfs' ? await objectUrl(videoBlob) : ''
  return {
    wallpaper,
    filename: wallpaper ? stored.filename : null,
    autoAccent: Boolean(wallpaper && stored.autoAccent),
    source,
    crop: wallpaper ? stored.crop : undefined,
    video,
    videoFilename: video ? (stored.videoFilename ?? null) : null,
  }
}

function publish(next: Appearance) {
  cache = next
  window.dispatchEvent(new Event(eventName))
  syncAppearanceAccent()
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
function syncAppearanceAccent() {
  const current = ++generation
  const prefs = loadAppearance()
  const restorePreset = () => setAccent(loadAccent())
  if (!prefs.autoAccent || !prefs.wallpaper) {
    restorePreset()
    return
  }
  const image = new Image()
  image.onload = () => {
    if (current === generation && !applyWallpaperAccent(image)) restorePreset()
  }
  image.onerror = () => {
    if (current === generation) restorePreset()
  }
  image.src = prefs.wallpaper
}

export function hydrateAppearance({ changedElsewhere = false } = {}) {
  return enqueue(async () => {
    if (changedElsewhere) forget(wallpaperBlob, sourceBlob, videoBlob)
    publish(await materialize(readStored()))
  })
}

export function saveAppearance(next: Appearance) {
  return enqueue(async () => {
    const stored = readStored()
    if (!next.wallpaper) {
      await blobs.remove(wallpaperBlob)
      await blobs.remove(sourceBlob)
      const cleared: StoredAppearance = {
        autoAccent: false,
        filename: null,
        wallpaper: '',
        video: stored.video,
        videoFilename: stored.videoFilename,
      }
      writeStored(cleared)
      forget(wallpaperBlob, sourceBlob)
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
      forget(wallpaperBlob, sourceBlob)
    }
    stored.filename = next.filename
    stored.crop = next.crop
    stored.autoAccent = next.autoAccent
    writeStored(stored)
    publish(await materialize(stored))
  })
}

export function saveVideoWallpaper(file: File | null) {
  return enqueue(async () => {
    const stored = readStored()
    if (file) {
      await blobs.put(videoBlob, file)
      stored.video = 'opfs'
      stored.videoFilename = file.name
    } else {
      await blobs.remove(videoBlob)
      stored.video = undefined
      stored.videoFilename = undefined
    }
    forget(videoBlob)
    writeStored(stored)
    publish(await materialize(stored))
  })
}

export function useAppearance() {
  const [appearance, setAppearance] = useState(loadAppearance)
  useEffect(() => {
    const sync = () => setAppearance(loadAppearance())
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) void hydrateAppearance({ changedElsewhere: true })
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

// Decoding a bitmap above this many pixels can freeze the tab, whatever the file size.
const maxDecodedPixels = 120_000_000
const unreadable = 'This image could not be opened. Try another one.'

function positiveSize(width: number, height: number) {
  if (width > 0 && height > 0) return { width, height }
  return undefined
}

function fourCC(view: DataView, offset: number) {
  return String.fromCharCode(...new Uint8Array(view.buffer, offset, 4))
}

function pngSize(view: DataView) {
  if (
    view.byteLength < 24 ||
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    fourCC(view, 12) !== 'IHDR'
  )
    return undefined
  return positiveSize(view.getUint32(16), view.getUint32(20))
}

function jpegSize(view: DataView) {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return undefined
  let offset = 2
  while (offset + 3 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return undefined
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset += 1
    if (offset >= view.byteLength) return undefined
    const marker = view.getUint8(offset)
    offset += 1
    if (marker === 0xd9 || marker === 0xda) return undefined
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > view.byteLength) return undefined
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > view.byteLength) return undefined
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      if (length < 7) return undefined
      return positiveSize(view.getUint16(offset + 5), view.getUint16(offset + 3))
    }
    offset += length
  }
  return undefined
}

function webpSize(view: DataView) {
  if (view.byteLength < 30 || fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WEBP')
    return undefined
  const kind = fourCC(view, 12)
  const uint24 = (offset: number) =>
    view.getUint16(offset, true) | (view.getUint8(offset + 2) << 16)
  if (kind === 'VP8X') return positiveSize(1 + uint24(24), 1 + uint24(27))
  if (kind === 'VP8 ' && uint24(23) === 0x2a019d)
    return positiveSize(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
  if (kind === 'VP8L' && view.getUint8(20) === 0x2f) {
    const bits = view.getUint32(21, true)
    return positiveSize((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  return undefined
}

const sizeReaders: Record<
  string,
  (view: DataView) => { width: number; height: number } | undefined
> = { 'image/jpeg': jpegSize, 'image/png': pngSize, 'image/webp': webpSize }

const videoTypes = new Set(['video/webm', 'video/mp4'])

export async function checkVideoWallpaper(file: File) {
  if (!videoTypes.has(file.type)) throw new Error('Choose a WebM or MP4 video.')
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'metadata'
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('This video could not be played. Try another one.'))
      video.src = url
    })
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

export async function prepareWallpaper(file: File): Promise<string> {
  const readSize = sizeReaders[file.type]
  if (!readSize) throw new Error('Choose a JPG, PNG, or WebP image.')
  const size = readSize(new DataView(await file.arrayBuffer()))
  if (!size) throw new Error(unreadable)
  if (size.width * size.height > maxDecodedPixels)
    throw new Error('This image is too large to open.')
  const fitted = wallpaperPixelSize(size.width, size.height)
  const bitmap = await createImageBitmap(file, {
    resizeWidth: fitted.width,
    resizeHeight: fitted.height,
    resizeQuality: 'high',
  }).catch(() => {
    throw new Error(unreadable)
  })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.toDataURL('image/webp', wallpaperQuality)
}
