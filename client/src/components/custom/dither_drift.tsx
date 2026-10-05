import { accentChangeEvent } from '@/lib/accent'
import { useResolvedTheme } from '@/lib/theme'
import { Dithering } from '@paper-design/shaders-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import './dither_drift.css'

let probe: CanvasRenderingContext2D | null | undefined

// Shaders take rgb; the theme speaks oklch, so the canvas mixes and converts.
function mix(front: string, back: string, amount: number) {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return back
  probe.globalAlpha = 1
  probe.fillStyle = back
  probe.fillRect(0, 0, 1, 1)
  probe.globalAlpha = amount
  probe.fillStyle = front
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}

function useDriftColors() {
  const theme = useResolvedTheme()
  const [colors, setColors] = useState<{ back: string; front: string }>()
  useEffect(() => {
    let frame = 0
    function update() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const style = getComputedStyle(document.documentElement)
        const back = mix(style.getPropertyValue('--background'), '#000', 1)
        const primary = mix(style.getPropertyValue('--primary'), '#000', 1)
        setColors({ back, front: mix(primary, back, theme === 'dark' ? 0.27 : 0.18) })
      })
    }
    update()
    window.addEventListener(accentChangeEvent, update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener(accentChangeEvent, update)
    }
  }, [theme])
  return colors
}

// The new-thread page's background without a wallpaper: accent swirls, dithered, slowly drifting.
// `base` replaces the ground; the swirls stay mixed against the theme background.
export function DitherDrift({ base }: { base?: string }) {
  const colors = useDriftColors()
  const reducedMotion = useReducedMotion()
  if (!colors) return null
  return (
    <Dithering
      className='dither-drift'
      aria-hidden='true'
      colorBack={base ?? colors.back}
      colorFront={colors.front}
      shape='warp'
      type='4x4'
      size={3}
      speed={reducedMotion ? 0 : 0.12}
    />
  )
}
