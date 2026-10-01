import { Button } from '@/components/ui/button'
import { accentChangeEvent } from '@/lib/accent'
import {
  backdropFields,
  backdropMarks,
  mutedStudies,
  setBackdropLook,
  useBackdropLook,
  type BackdropLook,
} from '@/lib/backdrop-study'
import { useAnimatedTheme, useResolvedTheme } from '@/lib/theme'
import { newThreadProject } from '@/lib/thread_project'
import { useChrome, useDraft } from '@/state'
import { Dithering, GrainGradient } from '@paper-design/shaders-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import { DriftingDither } from './drifting_dither'
import { ProjectGlyph } from './project_glyph'
import './backdrop_study.css'

// Temporary: compares new-thread backgrounds. Remove once one is chosen.

const fieldLabels: Record<BackdropLook['field'], string> = {
  none: 'None',
  glow: 'Glow',
  drift: 'Drift',
  project: 'Project',
  gradient: 'Gradient',
}
const markLabels: Record<BackdropLook['mark'], string> = {
  none: 'None',
  jetty: 'Jetty',
  name: 'Name',
  glyph: 'Glyph',
}
const mutedLabels: Record<BackdropLook['muted'], string> = {
  current: 'Current',
  light: 'Dim light',
  dark: 'Bright dark',
  middle: 'Middle',
}
const projectShapes = ['warp', 'simplex', 'wave', 'ripple', 'swirl'] as const

let probe: CanvasRenderingContext2D | null | undefined

// Shaders take rgb; the theme speaks oklch, so the canvas does the conversion.
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

function hashOf(text: string) {
  let hash = 7
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return hash
}

let glowImage: string | undefined

// A soft luminance pool around the composer, for the dither to quantise.
function glow() {
  if (glowImage) return glowImage
  const width = 480
  const height = 300
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return ''
  const pixels = context.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot((x / width - 0.5) / 0.36, (y / height - 0.6) / 0.42)
      const value = Math.round(Math.exp(-4 * distance * distance) * 230)
      const index = (y * width + x) * 4
      pixels.data[index] = value
      pixels.data[index + 1] = value
      pixels.data[index + 2] = value
      pixels.data[index + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  glowImage = canvas.toDataURL()
  return glowImage
}

function useThemeColors() {
  const theme = useResolvedTheme()
  const [colors, setColors] = useState<{
    background: string
    primary: string
    foreground: string
  }>()
  useEffect(() => {
    let frame = 0
    function update() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const style = getComputedStyle(document.documentElement)
        const read = (name: string) => mix(style.getPropertyValue(name), '#000', 1)
        setColors({
          background: read('--background'),
          primary: read('--primary'),
          foreground: read('--foreground'),
        })
      })
    }
    update()
    window.addEventListener(accentChangeEvent, update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener(accentChangeEvent, update)
    }
  }, [theme])
  return colors && { ...colors, dark: theme === 'dark' }
}

function useNewThreadProject() {
  const chrome = useChrome()
  const { draft } = useDraft('')
  if (!chrome) return undefined
  const picked = draft.target?.projectId
  const id = chrome.projects.some((project) => project.id === picked)
    ? picked
    : newThreadProject(chrome, undefined)
  return chrome.projects.find((project) => project.id === id)
}

export function BackdropStudy() {
  const look = useBackdropLook()
  const colors = useThemeColors()
  const project = useNewThreadProject()
  const reducedMotion = useReducedMotion()
  if (!colors) return null
  const speed = reducedMotion ? 0 : 1
  const strength = colors.dark ? 0.45 : 0.3
  const front = mix(colors.primary, colors.background, strength)
  const hash = hashOf(project?.id ?? '')
  const quiet = mix(colors.primary, colors.background, strength * 0.6)
  const projectFront = mix(
    `oklch(${colors.dark ? 0.72 : 0.62} 0.17 ${hash % 360})`,
    colors.background,
    strength * 2
  )
  return (
    <div className='backdrop-study' aria-hidden='true'>
      {look.field === 'glow' && (
        <DriftingDither
          className='backdrop-study-layer'
          image={glow()}
          colorBack={colors.background}
          colorFront={front}
          colorHighlight={front}
          type='4x4'
          colorSteps={2}
          size={3}
          fit='cover'
          drift={0}
        />
      )}
      {look.field === 'drift' && (
        <Dithering
          className='backdrop-study-layer backdrop-study-pool'
          colorBack={colors.background}
          colorFront={quiet}
          shape='warp'
          type='4x4'
          size={3}
          speed={0.12 * speed}
        />
      )}
      {look.field === 'project' && (
        <Dithering
          key={project?.id}
          className='backdrop-study-layer backdrop-study-pool'
          colorBack={colors.background}
          colorFront={projectFront}
          shape={projectShapes[hash % projectShapes.length]}
          type='4x4'
          size={3}
          scale={0.8 + (hash % 5) * 0.15}
          speed={0.06 * speed}
        />
      )}
      {look.field === 'gradient' && (
        <GrainGradient
          className='backdrop-study-layer backdrop-study-pool'
          colorBack={colors.background}
          colors={[front, mix(colors.primary, colors.background, strength * 0.5)]}
          shape='sphere'
          softness={0.8}
          intensity={0.3}
          noise={0.25}
          speed={0.25 * speed}
        />
      )}
      {look.grain && <div className='backdrop-study-layer backdrop-study-grain' />}
    </div>
  )
}

// A 5×7 pixel face; characters it lacks render as blanks.
const letters: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
}

function Wordmark({ text }: { text: string }) {
  const glyphs = [...text.toUpperCase()].slice(0, 12)
  const cells = glyphs.flatMap((letter, index) =>
    (letters[letter] ?? []).flatMap((row, y) =>
      [...row].flatMap((cell, x) => (cell === '#' ? [{ x: index * 6 + x, y }] : []))
    )
  )
  return (
    <svg
      viewBox={`0 0 ${glyphs.length * 6 - 1} 7`}
      className='w-full'
      fill='currentColor'
      shapeRendering='crispEdges'
    >
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} />
      ))}
    </svg>
  )
}

export function BackdropStudyMark() {
  const look = useBackdropLook()
  const project = useNewThreadProject()
  if (look.mark === 'none') return null
  return (
    <div className='backdrop-study-mark' aria-hidden='true'>
      {look.mark === 'jetty' ? (
        <div className='w-full max-w-[660px]'>
          <Wordmark text='Jetty' />
        </div>
      ) : look.mark === 'name' ? (
        <div className='w-full max-w-[660px]'>
          <Wordmark text={project?.title ?? ''} />
        </div>
      ) : (
        <ProjectGlyph key={project?.id} icon={project?.icon} className='size-40' />
      )}
    </div>
  )
}

function Options<T extends string>({
  label,
  values,
  labels,
  value,
  onChange,
}: {
  label: string
  values: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <fieldset
      aria-label={label}
      className='m-0 flex items-center gap-1 rounded-md border border-border bg-background p-1 text-xs'
    >
      <span className='w-14 px-1.5 text-muted-foreground'>{label}</span>
      {values.map((option) => (
        <Button
          key={option}
          variant='ghost'
          size='sm'
          aria-pressed={value === option}
          className='h-6 rounded-sm px-2 text-xs aria-pressed:bg-accent aria-pressed:text-foreground'
          onClick={() => onChange(option)}
        >
          {labels[option]}
        </Button>
      ))}
    </fieldset>
  )
}

export function BackdropStudyToggle() {
  const look = useBackdropLook()
  const { setTheme } = useAnimatedTheme()
  const theme = useResolvedTheme()
  return (
    <div className='flex flex-col items-end gap-1'>
      <Options
        label='Theme'
        values={['light', 'dark'] as const}
        labels={{ light: 'Light', dark: 'Dark' }}
        value={theme}
        onChange={setTheme}
      />
      <Options
        label='Muted'
        values={mutedStudies}
        labels={mutedLabels}
        value={look.muted}
        onChange={(muted) => setBackdropLook({ ...look, muted })}
      />
      <Options
        label='Field'
        values={backdropFields}
        labels={fieldLabels}
        value={look.field}
        onChange={(field) => setBackdropLook({ ...look, field })}
      />
      <Options
        label='Mark'
        values={backdropMarks}
        labels={markLabels}
        value={look.mark}
        onChange={(mark) => setBackdropLook({ ...look, mark })}
      />
      <Options
        label='Grain'
        values={['off', 'on'] as const}
        labels={{ off: 'Off', on: 'On' }}
        value={look.grain ? 'on' : 'off'}
        onChange={(grain) => setBackdropLook({ ...look, grain: grain === 'on' })}
      />
    </div>
  )
}
