import type { SubagentStatus } from '@jetty/shared/items'
import type { ComponentType, SVGProps } from 'react'

import { cn } from '@/lib/utils'

import './subagent_glyph.css'

export type SubagentGlyphState = 'running' | 'waiting' | 'failed' | 'done' | 'stopped'

// First frames, row-major: what reduced motion shows, and where each animation starts.
const frames: Record<SubagentGlyphState, number[]> = {
  running: [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 1, 0.7, 0.45],
  waiting: [0.25, 0.25, 0.25, 1, 1, 1, 0.25, 0.25, 0.25],
  failed: [1, 0.25, 1, 0.25, 1, 0.25, 1, 0.25, 1],
  done: [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45],
  stopped: [0.25, 0.25, 0.25, 1, 1, 1, 0.25, 0.25, 0.25],
}

const look: Record<SubagentGlyphState, { color: string; label: string }> = {
  running: { color: 'text-muted-foreground', label: 'Running' },
  waiting: { color: 'text-status-attention', label: 'Waiting for approval' },
  failed: { color: 'text-status-error', label: 'Failed' },
  done: { color: 'text-muted-foreground', label: 'Finished' },
  stopped: { color: 'text-muted-foreground', label: 'Stopped' },
}

export function subagentGlyphState(status: SubagentStatus, waiting = false): SubagentGlyphState {
  if (status === 'running') return waiting ? 'waiting' : 'running'
  return status === 'completed' ? 'done' : status
}

// Capy's dot grid: 14×14, r=1, centres at 3/7/11.
export function SubagentGlyph({
  state,
  className,
}: {
  state: SubagentGlyphState
  className?: string
}) {
  return (
    <svg
      viewBox='0 0 14 14'
      fill='currentColor'
      className={cn('subagent-glyph', `subagent-glyph-${state}`, look[state].color, className)}
      aria-hidden='true'
      focusable='false'
    >
      {frames[state].map((opacity, index) => (
        <circle
          key={index}
          cx={3 + (index % 3) * 4}
          cy={3 + Math.floor(index / 3) * 4}
          r={1}
          data-dot={index}
          style={{ opacity }}
        />
      ))}
    </svg>
  )
}

// A glyph per state as a component, for places that take an icon type (a link's lead).
export const subagentGlyphIcons = Object.fromEntries(
  (Object.keys(frames) as SubagentGlyphState[]).map((state) => [
    state,
    ({ className }: SVGProps<SVGSVGElement>) => (
      <SubagentGlyph state={state} className={className} />
    ),
  ])
) as Record<SubagentGlyphState, ComponentType<SVGProps<SVGSVGElement>>>

export const subagentGlyphLabel = (state: SubagentGlyphState) => look[state].label

const tokenFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatSubagentTokens(tokens: number) {
  return tokenFormatter.format(tokens).toLowerCase()
}

export function renderWorkingTitle(title: string) {
  return <span className='shimmer text-muted-foreground'>{title}</span>
}
