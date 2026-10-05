import type { ContextUsage } from '@jetty/shared/events'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useThreadContext } from '@/state'

import './context_ring.css'

const radius = 90
const circumference = 2 * Math.PI * radius

function fullness(context: ContextUsage | null) {
  return context ? Math.max(0, Math.min(1, context.usedTokens / context.maxTokens)) : 0
}

// How full a thread's context window is; red from 90%.
export function ContextRing({
  context,
  className,
}: {
  context: ContextUsage | null
  className?: string
}) {
  const fraction = fullness(context)
  return (
    <svg
      viewBox='0 0 256 256'
      aria-hidden='true'
      className={cn(fraction >= 0.9 ? 'text-destructive' : 'text-foreground', className)}
    >
      <circle
        cx='128'
        cy='128'
        r={radius}
        fill='none'
        strokeWidth='26'
        className='stroke-muted-foreground/40'
      />
      {context && (
        <circle
          cx='128'
          cy='128'
          r={radius}
          fill='none'
          strokeWidth='26'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform='rotate(-90 128 128)'
        />
      )}
    </svg>
  )
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

// 104.4k, 1m: the subagent rows' token format.
function tokens(count: number) {
  return compact.format(count).toLowerCase()
}

const providerNames: Record<string, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok' }

const hues: Record<string, string> = {
  'System prompt': 'var(--slice-system-prompt)',
  'System tools': 'var(--slice-system-tools)',
  'MCP tools': 'var(--slice-mcp-tools)',
  'Memory files': 'var(--slice-memory-files)',
  Skills: 'var(--slice-skills)',
  Messages: 'var(--slice-messages)',
}

// Colour follows the category; one Claude Code adds later stays grey rather than taking a made-up hue.
function hue(label: string) {
  return hues[label] ?? 'var(--muted-foreground)'
}

function largestFirst(context: ContextUsage): ContextUsage {
  return { ...context, slices: context.slices.toSorted((a, b) => b.tokens - a.tokens) }
}

// Measured against the whole window, so the bar reads as full as the ring; the header has the
// figures. A provider that sends only a total gets a single segment.
function ContextBar({ context }: { context: ContextUsage }) {
  const segments =
    context.slices.length > 0
      ? context.slices.map((slice) => ({
          key: slice.label,
          tokens: slice.tokens,
          color: hue(slice.label),
        }))
      : [{ key: 'used', tokens: context.usedTokens, color: 'var(--foreground)' }]
  return (
    <div aria-hidden='true' className='flex h-1.5 gap-px overflow-hidden rounded-full bg-accent'>
      {segments.map((segment) => (
        <span
          key={segment.key}
          className='h-full min-w-px shrink-0'
          style={{
            width: `${(segment.tokens / context.maxTokens) * 100}%`,
            background: segment.color,
          }}
        />
      ))}
    </div>
  )
}

function ContextBreakdown({
  context,
  provider,
}: {
  context: ContextUsage | null
  provider: string
}) {
  if (!context)
    return (
      <>
        <span className='font-medium'>Context</span>
        <div className='h-1.5 rounded-full bg-accent' />
        <p className='text-muted-foreground'>
          {provider === 'grok' ? 'Grok doesn’t report context usage.' : 'No context reading yet.'}
        </p>
      </>
    )
  const fraction = fullness(context)
  return (
    <>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='font-medium'>Context</span>
        <span className='text-muted-foreground tabular-nums'>
          {tokens(context.usedTokens)} / {tokens(context.maxTokens)} used (
          <span className={cn('tabular-nums', fraction >= 0.9 && 'text-destructive')}>
            {Math.round(fraction * 100)}%
          </span>
          )
        </span>
      </div>
      <ContextBar context={context} />
      {context.slices.length > 0 ? (
        <div className='flex flex-col gap-1.5'>
          {context.slices.map((slice) => (
            <div key={slice.label} className='flex items-center gap-2'>
              <span
                aria-hidden='true'
                className='size-2 shrink-0 rounded-xs'
                style={{ background: hue(slice.label) }}
              />
              <span className='min-w-0 flex-1 truncate'>{slice.label}</span>
              <span className='text-muted-foreground tabular-nums'>{tokens(slice.tokens)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className='text-muted-foreground'>
          {providerNames[provider] ?? provider} reports a total, not what fills it.
        </p>
      )}
    </>
  )
}

// Opens on click, not pointer-down: it's an overlay (JET-3).
export function ThreadContextRing({ threadId, provider }: { threadId: string; provider: string }) {
  const context = useThreadContext(threadId)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            aria-label={
              context
                ? `Context window ${Math.round(fullness(context) * 100)}% full`
                : 'Context usage unavailable'
            }
          />
        }
      >
        <ContextRing context={context} />
      </PopoverTrigger>
      <PopoverContent
        side='top'
        align='end'
        sideOffset={6}
        className='context-popover w-72 gap-3 p-3 text-xs'
      >
        <ContextBreakdown context={context && largestFirst(context)} provider={provider} />
      </PopoverContent>
    </Popover>
  )
}
