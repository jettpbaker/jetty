import { Button } from '@/components/ui/button'
import { useResolvedTheme } from '@/lib/theme'
import { storage } from '@/platform'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import './wallpaper_fade_study.css'

// Temporary: compares how a wallpaper fades out in light mode. Remove once one is chosen.

export const wallpaperFades = ['current', 'clean', 'dissolve'] as const
export type WallpaperFade = (typeof wallpaperFades)[number]

const labels: Record<WallpaperFade, string> = {
  current: 'Current',
  clean: 'Clean',
  dissolve: 'Dissolve',
}
const storageKey = 'jetty.wallpaper-fade-study'
const listeners = new Set<() => void>()
let fade: WallpaperFade =
  wallpaperFades.find((value) => value === storage.get(storageKey)) ?? 'current'

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setWallpaperFade(next: WallpaperFade) {
  fade = next
  storage.set(storageKey, next)
  for (const listener of listeners) listener()
}

export function useWallpaperFade() {
  return useSyncExternalStore(subscribe, () => fade)
}

export function WallpaperFadeToggle() {
  const value = useWallpaperFade()
  return (
    <fieldset
      aria-label='Wallpaper fade in light mode'
      className='absolute right-4 bottom-4 z-20 m-0 flex items-center gap-1 rounded-md border border-border bg-background p-1 text-xs'
    >
      <span className='px-1.5 text-muted-foreground'>Light fade</span>
      {wallpaperFades.map((option) => (
        <Button
          key={option}
          variant='ghost'
          size='sm'
          aria-pressed={value === option}
          className='h-6 rounded-sm px-2 text-xs aria-pressed:bg-accent aria-pressed:text-foreground'
          onClick={() => setWallpaperFade(option)}
        >
          {labels[option]}
        </Button>
      ))}
    </fieldset>
  )
}

const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const block = 3

// How much of the wallpaper survives at a height: all of it above 45%, none by 95%.
function visibleAt(position: number) {
  const t = Math.min(1, Math.max(0, (position - 0.45) / 0.5))
  return 1 - t * t * (3 - 2 * t)
}

// Covers the wallpaper in page-coloured blocks on an ordered-dither threshold, so it breaks
// up toward the bottom instead of washing out.
export function WallpaperDissolve() {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = useResolvedTheme()
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !context) return
    function draw() {
      if (!canvas || !context) return
      const { width, height } = canvas.getBoundingClientRect()
      const columns = Math.max(1, Math.ceil(width / block))
      const rows = Math.max(1, Math.ceil(height / block))
      canvas.width = columns
      canvas.height = rows
      context.fillStyle = getComputedStyle(canvas).color
      context.fillRect(0, 0, 1, 1)
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data
      const pixels = context.createImageData(columns, rows)
      for (let y = 0; y < rows; y++) {
        const visible = visibleAt(y / rows)
        // Surviving blocks pale as they go, so the last stragglers aren't hard dark dots.
        const veil = Math.round((1 - visible) * 200)
        for (let x = 0; x < columns; x++) {
          const covered = (bayer[(y % 4) * 4 + (x % 4)]! + 0.5) / 16 >= visible
          const index = (y * columns + x) * 4
          pixels.data[index] = r!
          pixels.data[index + 1] = g!
          pixels.data[index + 2] = b!
          pixels.data[index + 3] = covered ? 255 : veil
        }
      }
      context.putImageData(pixels, 0, 0)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [theme])
  return <canvas ref={ref} className='wallpaper-dissolve' aria-hidden='true' />
}
