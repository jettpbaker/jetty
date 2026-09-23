import { storage } from '@/platform'
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
const eventName = 'jetty-appearance'
export function loadAppearance(): Appearance {
  try {
    const data = JSON.parse(storage.get(key) ?? 'null')
    if (!data || typeof data.autoAccent !== 'boolean') return defaults
    const custom =
      typeof data.wallpaper === 'string' &&
      /^data:image\/(jpeg|png|webp);base64,/.test(data.wallpaper)
    const result: Appearance = {
      wallpaper: custom
        ? data.wallpaper
        : data.wallpaper === defaultWallpaperSrc
          ? defaultWallpaperSrc
          : '',
      filename: custom && typeof data.filename === 'string' ? data.filename : null,
      autoAccent: Boolean((custom || data.wallpaper === defaultWallpaperSrc) && data.autoAccent),
    }
    if (
      custom &&
      (data.source === defaultWallpaperSrc ||
        (typeof data.source === 'string' &&
          /^data:image\/(jpeg|png|webp);base64,/.test(data.source)))
    ) {
      result.source = data.source
      const c = data.crop
      if (
        c &&
        [c.aspect, c.zoom, c.x, c.y].every(Number.isFinite) &&
        c.aspect > 0 &&
        c.zoom >= 1 &&
        c.zoom <= 10.001 &&
        c.x >= 0 &&
        c.x <= 1 &&
        c.y >= 0 &&
        c.y <= 1
      )
        result.crop = c
    }
    return result
  } catch {
    return defaults
  }
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
export function saveAppearance(next: Appearance) {
  storage.set(key, JSON.stringify(next))
  window.dispatchEvent(new Event(eventName))
  syncAppearanceAccent()
}
export function useAppearance() {
  const [appearance, setAppearance] = useState(loadAppearance)
  useEffect(() => {
    const sync = () => setAppearance(loadAppearance())
    window.addEventListener(eventName, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(eventName, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return appearance
}

// Store a display-sized image so uploads survive reloads without exhausting browser storage.
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
