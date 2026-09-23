import { blobs, storage } from '@/platform'
import { useEffect, useState } from 'react'

import type { WallpaperCrop } from './wallpaper-crop'

import { loadAccent, setAccent } from './accent'
import { applyWallpaperAccent } from './wallpaper-accent'

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

// Display-sized bytes live in OPFS. The data URL only crosses into saveAppearance.
export async function prepareWallpaper(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPG, PNG, or WebP image.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This image could not be processed. Try another one.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', 0.85)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'EncodingError')
      throw new Error('This image could not be opened. Try another one.')
    throw error
  } finally {
    URL.revokeObjectURL(url)
  }
}
