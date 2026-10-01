import { Button } from '@/components/ui/button'
import { storage } from '@/platform'
import { useSyncExternalStore, type ReactNode } from 'react'

// Temporary: compares how a wallpaper fades out in light mode. Remove once one is chosen.

export const wallpaperFades = ['current', 'jett', 'clean'] as const
export type WallpaperFade = (typeof wallpaperFades)[number]

const labels: Record<WallpaperFade, string> = {
  current: 'Current',
  jett: 'Jett',
  clean: 'Clean',
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

// Fades the wallpaper out by the composer's bottom edge (the composer sits centred), so the
// buttons beneath it read on the plain page colour.
const stops = [1, 0.97, 0.88, 0.72, 0.5, 0.3, 0.14, 0.04, 0]
const composerFade = `linear-gradient(to bottom, ${stops
  .map(
    (alpha, index) =>
      `rgb(0 0 0 / ${alpha}) calc(50% - 12rem + ${(16.5 * index) / (stops.length - 1)}rem)`
  )
  .join(', ')})`

export function ComposerFade({ children }: { children: ReactNode }) {
  return (
    <div
      className='background-stack'
      style={{ background: 'var(--background)' }}
      aria-hidden='true'
    >
      <div className='background-fade' style={{ maskImage: composerFade }}>
        {children}
      </div>
    </div>
  )
}
