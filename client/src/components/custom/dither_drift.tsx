import { accentChangeEvent } from '@/lib/accent'
import { useResolvedTheme } from '@/lib/theme'
import { Dithering } from '@paper-design/shaders-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

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
        setColors({ back, front: mix(primary, back, 0.35) })
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
export function DitherDrift() {
  const colors = useDriftColors()
  const reducedMotion = useReducedMotion()
  if (!colors) return null
  return (
    <Dithering
      className='pointer-events-none absolute inset-0'
      aria-hidden='true'
      colorBack={colors.back}
      colorFront={colors.front}
      shape='warp'
      type='4x4'
      size={3}
      speed={reducedMotion ? 0 : 0.12}
    />
  )
}
