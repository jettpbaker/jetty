import type { ContextSlice, ContextUsage } from '@jetty/shared/events'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const RING_RADIUS = 9.5
const RING_STROKE = 3
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** past this the window is the problem, not a detail */
const CROWDED_PCT = 90

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

function fillCap(usage: ContextUsage): number {
  return usage.compactAt ?? usage.maxTokens
}

function percentOf(usage: ContextUsage): number {
  return Math.min(100, Math.round((usage.usedTokens / fillCap(usage)) * 100))
}

/** Ember and grey alternate: neighbouring slices have to stay apart at chip size. */
const SLICE_TINTS = [
  'color-mix(in oklab, var(--code-foreground) 78%, var(--code))',
  'color-mix(in oklab, var(--muted-foreground) 88%, var(--popover))',
  'var(--code-foreground)',
  'color-mix(in oklab, var(--muted-foreground) 62%, var(--popover))',
  'var(--code-glow)',
]

function sliceTint(index: number): string {
  return SLICE_TINTS[index % SLICE_TINTS.length]!
}

function ContextRing({ pct }: { pct: number }) {
  return (
    <svg viewBox='0 0 22 22' aria-hidden='true'>
      <circle
        cx={11}
        cy={11}
        r={RING_RADIUS}
        fill='none'
        strokeWidth={RING_STROKE}
        className='stroke-border'
      />
      <circle
        cx={11}
        cy={11}
        r={RING_RADIUS}
        fill='none'
        stroke='currentColor'
        strokeWidth={RING_STROKE}
        strokeLinecap='round'
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct / 100)}
        className='origin-center -rotate-90 transition-[stroke-dashoffset] duration-500 ease-out'
      />
    </svg>
  )
}

/** An agent that reports a total but no categories still gets a bar. */
function slicesOf(usage: ContextUsage): ContextSlice[] {
  if (usage.slices.length > 0) return usage.slices
  return [{ label: 'Used', tokens: usage.usedTokens }]
}

export function ContextMeter({ usage }: { usage: ContextUsage }) {
  const pct = percentOf(usage)
  const crowded = pct >= CROWDED_PCT
  const slices = slicesOf(usage)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <PromptInputButton
            variant='ghost-text'
            size='xs'
            aria-label={`Context window ${pct}% full`}
            data-cuelume-hover='tick'
            className={cn(
              'h-auto min-h-0 gap-1 px-1.5 py-0 font-mono',
              crowded && 'text-destructive hover:text-destructive'
            )}
          >
            <ContextRing pct={pct} />
            <span className='tabular-nums'>{pct}%</span>
          </PromptInputButton>
        }
      />
      <PopoverContent align='end' side='top' sideOffset={8} className='w-64 gap-3 p-3'>
        <div className='flex flex-col gap-2'>
          <div className='flex items-baseline justify-between gap-3'>
            <span className='text-xs font-medium'>Context</span>
            <span className='font-mono text-xs text-muted-foreground tabular-nums'>
              {formatTokens(usage.usedTokens)} / {formatTokens(usage.maxTokens)}
            </span>
          </div>
          <div className='relative flex h-1.5 overflow-hidden rounded-full bg-muted'>
            <div className='flex h-full min-w-0 flex-1 gap-px'>
              {slices.map((slice, index) => (
                <div
                  key={slice.label}
                  className='h-full min-w-px'
                  style={{
                    width: `${(slice.tokens / usage.maxTokens) * 100}%`,
                    background: sliceTint(index),
                  }}
                />
              ))}
            </div>
            {usage.compactAt !== undefined && usage.compactAt < usage.maxTokens && (
              <div
                aria-hidden='true'
                className='absolute inset-y-0 w-px bg-foreground'
                style={{ left: `${(usage.compactAt / usage.maxTokens) * 100}%` }}
              />
            )}
          </div>
        </div>
        <div className='flex flex-col gap-1.5'>
          {slices.map((slice, index) => (
            <div key={slice.label} className='flex items-center justify-between gap-3 text-xs'>
              <span className='flex min-w-0 items-center gap-2 text-muted-foreground'>
                <span
                  className='size-2 shrink-0 rounded-xs'
                  style={{ background: sliceTint(index) }}
                />
                <span className='truncate'>{slice.label}</span>
              </span>
              <span className='font-mono text-xs text-muted-foreground tabular-nums'>
                {formatTokens(slice.tokens)}
              </span>
            </div>
          ))}
        </div>
        {usage.compactAt !== undefined && (
          <p className='text-xs text-muted-foreground'>
            Compacts automatically at {formatTokens(usage.compactAt)}.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
