import type { ContextUsage } from '@jetty/shared/events'
import type { ProviderUsage } from '@jetty/shared/wire'

import { ChevronRightSmallIcon } from '@/components/custom/central_icons'
import { Mono, RingLimits } from '@/components/custom/usage_limits'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'
import { useThreadContext } from '@/state'
import {
  allUsageProviders,
  usageFreshMs,
  usageProviders,
  useProviderUsage,
  type UsageProvider,
} from '@/state/provider-usage'
import { useEffect } from 'react'

import './context_ring.css'

const radius = 90
const circumference = 2 * Math.PI * radius

function fullness(context: ContextUsage | null) {
  return context ? Math.max(0, Math.min(1, context.usedTokens / context.maxTokens)) : 0
}

// The ring's rule: the last 10% of anything is red.
function nearCap(fraction: number) {
  return fraction >= 0.9
}

function capacityTone(fraction: number) {
  return nearCap(fraction)
    ? 'text-destructive'
    : fraction >= 0.75
      ? 'text-status-attention'
      : undefined
}

// How full a thread's context window is; amber from 75%, red from 90%.
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
      className={cn(capacityTone(fraction) ?? 'text-foreground', className)}
    >
      <circle
        cx='128'
        cy='128'
        r={radius}
        fill='none'
        strokeWidth='26'
        className='stroke-muted-foreground/60'
      />
      {context && (
        <circle
          cx='128'
          cy='128'
          r={radius}
          fill='none'
          strokeWidth='26'
          stroke='currentColor'
          strokeLinecap='butt'
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

// Fills as used, like the ring that opens it.
function Gauge({ fraction }: { fraction: number }) {
  return (
    <span aria-hidden='true' className='relative block h-1 overflow-hidden rounded-full bg-accent'>
      <span
        className={cn(
          'absolute inset-y-0 left-0 rounded-full',
          nearCap(fraction) ? 'bg-destructive' : 'bg-foreground'
        )}
        style={{ width: `${fraction * 100}%` }}
      />
    </span>
  )
}

// One segment per slice, measured against the whole window so the bar reads as full as the ring.
function SliceGauge({ context }: { context: ContextUsage }) {
  return (
    <span
      aria-hidden='true'
      className='relative flex h-1 gap-px overflow-hidden rounded-full bg-accent'
    >
      {context.slices.map((slice) => (
        <span
          key={slice.label}
          className='h-full min-w-px shrink-0'
          style={{
            width: `${(slice.tokens / context.maxTokens) * 100}%`,
            background: hue(slice.label),
          }}
        />
      ))}
    </span>
  )
}

function Headroom({ context }: { context: ContextUsage }) {
  return context.compactAt === undefined ? (
    <span className='text-muted-foreground'>
      <Mono>{tokens(Math.max(0, context.maxTokens - context.usedTokens))}</Mono> left
    </span>
  ) : (
    <span className='text-muted-foreground'>
      <Mono>{tokens(Math.max(0, context.compactAt - context.usedTokens))}</Mono> until auto-compact
    </span>
  )
}

function ContextDetails({ context }: { context: ContextUsage | null }) {
  if (!context)
    return (
      <div className='flex flex-col gap-2'>
        <span className='font-medium'>Context window</span>
        <Gauge fraction={0} />
        <span className='text-muted-foreground'>No context reading yet.</span>
      </div>
    )
  const slices = context.slices.toSorted((a, b) => b.tokens - a.tokens)
  const fraction = fullness(context)
  return (
    <Collapsible className='flex flex-col gap-2'>
      <div className='flex items-center justify-between gap-3'>
        <span className='font-medium'>Context window</span>
        <Mono className={capacityTone(fraction)}>{Math.round(fraction * 100)}% used</Mono>
      </div>
      {slices.length > 0 ? <SliceGauge context={context} /> : <Gauge fraction={fraction} />}
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-muted-foreground'>
        <Mono>
          {tokens(context.usedTokens)} / {tokens(context.maxTokens)} tokens
        </Mono>
        <Headroom context={context} />
      </div>
      {slices.length > 0 && (
        <>
          <CollapsibleTrigger
            render={
              <Button
                variant='ghost-text'
                size='xs'
                className='self-start px-0 [&[aria-expanded=true]>svg]:rotate-90'
              />
            }
          >
            <ChevronRightSmallIcon />
            Token breakdown
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className='grid grid-cols-2 gap-x-4 gap-y-1 pt-0.5'>
              {slices.map((slice) => (
                <div key={slice.label} className='flex min-w-0 items-center gap-1.5'>
                  <span
                    aria-hidden='true'
                    className='size-2 shrink-0 rounded-xs'
                    style={{ background: hue(slice.label) }}
                  />
                  <span className='min-w-0 flex-1 truncate text-muted-foreground'>
                    {slice.label}
                  </span>
                  <Mono className='text-muted-foreground'>{tokens(slice.tokens)}</Mono>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </>
      )}
    </Collapsible>
  )
}

// This thread's provider first, then the others Usage shows.
function limitProviders(provider: UsageProvider) {
  return [provider, ...usageProviders().filter((id) => id !== provider)]
}

// Mounted only while the popover is open, so opening it is the read: the last reads show at once,
// and any older than Usage's freshness are read again. Never in the background.
function PopoverLimits({ provider }: { provider: UsageProvider }) {
  const { reads, failed, refresh } = useProviderUsage()
  useEffect(() => refresh(limitProviders(provider), usageFreshMs), [provider, refresh])
  const providers = limitProviders(provider)
  const usage: Partial<Record<UsageProvider, ProviderUsage>> = {}
  const at: number[] = []
  for (const id of providers) {
    const read = reads[id]
    if (!read) continue
    usage[id] = read.usage
    at.push(read.at)
  }
  const now = Math.max(useNow(60_000), ...at)
  return (
    <RingLimits
      provider={provider}
      others={providers.slice(1)}
      usage={usage}
      failed={failed}
      now={now}
    />
  )
}

// Opens on click, not pointer-down: it's an overlay (JET-3).
export function ThreadContextRing({ threadId, provider }: { threadId: string; provider: string }) {
  const context = useThreadContext(threadId)
  const limits = allUsageProviders.find((id) => id === provider)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            aria-label={
              context
                ? `Context window ${Math.round(fullness(context) * 100)}% full`
                : 'Context usage unavailable'
            }
          />
        }
      >
        <ContextRing context={context} />
        <span className={cn('font-mono text-xs', capacityTone(fullness(context)))}>
          {context ? `${Math.round(fullness(context) * 100)}%` : '—'}
        </span>
        <span className='text-xs @max-[600px]/composer:hidden'>context</span>
      </PopoverTrigger>
      <PopoverContent
        side='top'
        align='end'
        sideOffset={6}
        className='context-popover w-80 gap-3 p-3 text-xs'
      >
        <ContextDetails context={context} />
        {limits && <PopoverLimits provider={limits} />}
      </PopoverContent>
    </Popover>
  )
}
