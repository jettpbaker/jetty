import type { ProviderUsage, UsageWindow } from '@jetty/shared/wire'

import {
  ArrowUpRight01Icon,
  Cancel01Icon,
  Refresh01Icon,
  UndoIcon,
} from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { PageSidebarTrigger } from './page_sidebar_trigger'
import { ProviderGlyph } from './provider_glyph'
import './usage_limits.css'

export type UsageProvider = ProviderUsage['provider']

export const providerNames: Record<UsageProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
}

const minute = 60_000
const resetFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function percentLeft(window: UsageWindow) {
  return Math.round(100 - clamp(window.pct, 0, 100))
}

// The share of the window still to run, 0–1.
function timeLeft(window: UsageWindow, now: number) {
  if (window.resetsAt === undefined || !window.minutes) return undefined
  return clamp((window.resetsAt - now) / (window.minutes * minute), 0, 1)
}

function duration(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / minute))
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}

// Spending at the rate so far hits the limit before the reset: said only when that's more than five points ahead of an even pace.
function paceOf(window: UsageWindow, now: number) {
  const left = timeLeft(window, now)
  if (left === undefined || left > 0.95 || window.pct >= 100 || window.pct - (1 - left) * 100 <= 5)
    return undefined
  const spent = (1 - left) * window.minutes! * minute
  const runsOut = now + ((100 - window.pct) * spent) / window.pct
  const soon = runsOut - now < 12 * 60 * minute
  // Five-minute marks within the next 12 hours, whole hours past that.
  const step = soon ? 5 * minute : 60 * minute
  return `At this pace, runs out around ${(soon ? clockFormat : dayFormat).format(Math.round(runsOut / step) * step)}`
}

function resetIn(window: UsageWindow, now: number) {
  if (window.resetsAt === undefined) return undefined
  return window.resetsAt <= now ? 'now' : duration(window.resetsAt - now)
}

/* The bar: quota left in the provider's colour. */

function UsageBar({ window, className }: { window: UsageWindow; className?: string }) {
  const left = percentLeft(window)
  return (
    <span
      aria-hidden='true'
      className={cn('relative overflow-hidden rounded-full bg-accent', className)}
    >
      {left > 0 && (
        <span
          className='absolute inset-y-0 left-0 rounded-full bg-(--usage-color)'
          style={{ width: `${left}%` }}
        />
      )}
    </span>
  )
}

/* One provider's windows: label, bar, what's left, and when it resets, with the pace in words when it's running out early. Hover for the exact time, the plan and the account. */

function UsageRow({
  usage,
  window,
  now,
  compact,
}: {
  usage: ProviderUsage
  window: UsageWindow
  now: number
  compact: boolean
}) {
  const left = percentLeft(window)
  const reset = resetIn(window, now)
  const pace = paceOf(window, now)
  const who = [usage.plan, usage.account].filter(Boolean).join(' · ')
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus shows the row's reset time and account
            tabIndex={0}
            className='col-span-full grid grid-cols-subgrid items-center gap-y-1 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
          />
        }
      >
        <span className='truncate text-xs text-muted-foreground'>{window.label}</span>
        <UsageBar window={window} className={compact ? 'h-0.75' : 'h-1'} />
        <span
          className={cn('text-right text-xs', left <= 10 ? 'text-destructive' : 'text-foreground')}
        >
          <span className='font-mono tabular-nums'>{left}%</span> left
        </span>
        <span
          className={cn(
            'flex items-center justify-end gap-1 font-mono text-xs tabular-nums',
            left === 0 ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {reset && (
            <>
              <UndoIcon aria-hidden='true' className='size-3' />
              <span className='sr-only'>Resets in</span>
              {reset}
            </>
          )}
        </span>
        {pace && <span className='col-[2/-1] text-xs text-muted-foreground'>{pace}</span>}
      </TooltipTrigger>
      <TooltipContent className='flex-col items-start gap-1'>
        {window.resetsAt !== undefined && <span>Resets {resetFormat.format(window.resetsAt)}</span>}
        {who && <span className='text-muted-foreground'>{who}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function windowsGrid(compact: boolean) {
  return compact
    ? 'grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_4.25rem_4.25rem] gap-x-3 gap-y-2'
    : 'grid-cols-[minmax(0,8rem)_minmax(0,1fr)_4.5rem_4.5rem] gap-x-4 gap-y-3.5'
}

function UsageWindows({
  usage,
  now,
  compact = false,
}: {
  usage: ProviderUsage
  now: number
  compact?: boolean
}) {
  if (usage.failed && usage.windows.length === 0)
    return <p className='text-xs text-muted-foreground'>Couldn’t read usage.</p>
  if (!usage.connected) return <p className='text-xs text-muted-foreground'>Not signed in.</p>
  if (usage.windows.length === 0)
    return <p className='text-xs text-muted-foreground'>No limits reported.</p>
  return (
    <div data-usage-provider={usage.provider} className={cn('grid', windowsGrid(compact))}>
      {usage.windows.map((window) => (
        <UsageRow key={window.id} usage={usage} window={window} now={now} compact={compact} />
      ))}
    </div>
  )
}

// A provider's first read, before anything has ever loaded: two quiet rows in the windows' grid.
function UsageSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden='true' className={cn('grid items-center', windowsGrid(compact))}>
      {[0, 1].map((row) => (
        <div key={row} className='col-span-full grid h-4 grid-cols-subgrid items-center'>
          <Skeleton className='h-3 w-12 rounded-xs' />
          <Skeleton className={cn('rounded-full', compact ? 'h-0.75' : 'h-1')} />
        </div>
      ))}
    </div>
  )
}

/* The page */

function updatedLabel(at: number, now: number) {
  return now - at < minute ? 'just now' : `${duration(now - at)} ago`
}

// Each provider's section shows as soon as its own read lands; until then (and only if it never has) it holds skeleton rows.
export function UsagePage({
  providers,
  usage,
  now,
  updatedAt,
  refreshing,
  failed,
  onRefresh,
}: {
  providers: readonly UsageProvider[]
  usage: Partial<Record<UsageProvider, ProviderUsage>>
  now: number
  updatedAt?: number
  refreshing: boolean
  // the providers whose latest read failed
  failed: ReadonlySet<UsageProvider>
  onRefresh: () => void
}) {
  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <header className='flex h-(--app-tab-bar-height,42px) shrink-0 items-center justify-between gap-2 border-b border-border pl-(--page-header-inset,16px) pr-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <PageSidebarTrigger />
          <h1 className='truncate text-sm font-medium'>Usage</h1>
        </div>
        <div className='flex items-center gap-2'>
          {providers.length > 0 && providers.every((provider) => failed.has(provider)) ? (
            <span className='text-xs text-muted-foreground'>Couldn’t refresh</span>
          ) : (
            updatedAt !== undefined && (
              <span className='text-xs text-muted-foreground'>
                Updated {updatedLabel(updatedAt, now)}
              </span>
            )
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label='Refresh usage'
                  aria-busy={refreshing}
                  disabled={refreshing}
                  onClick={onRefresh}
                />
              }
            >
              {refreshing ? <Spinner className='size-3' /> : <Refresh01Icon />}
            </TooltipTrigger>
            <TooltipContent>Refresh usage</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div className='scroll-fade-y scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain'>
        <div className='mx-auto flex w-full max-w-[708px] flex-col gap-10 px-6 py-8'>
          {providers.map((provider) => {
            const item = usage[provider]
            return (
              <section
                key={provider}
                aria-labelledby={`usage-${provider}`}
                aria-busy={item === undefined}
                className='flex flex-col gap-4'
              >
                <div className='flex items-center gap-2 text-muted-foreground'>
                  <ProviderGlyph provider={provider} className='size-4' />
                  <h2 id={`usage-${provider}`} className='text-sm font-medium'>
                    {providerNames[provider]}
                  </h2>
                  {item && (item.failed || failed.has(provider)) && item.windows.length > 0 && (
                    <span className='ml-auto text-xs'>
                      Couldn’t refresh
                      {item.asOf !== undefined && ` · last read ${updatedLabel(item.asOf, now)}`}
                    </span>
                  )}
                </div>
                {item ? (
                  <UsageWindows usage={item} now={now} />
                ) : failed.has(provider) ? (
                  <p className='text-xs text-muted-foreground'>Usage unavailable.</p>
                ) : (
                  <UsageSkeleton />
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* /usage: the current thread's provider in a tray over the composer */

export function UsageBanner({
  provider,
  usage,
  failed,
  now,
  onOpen,
  onDismiss,
}: {
  provider: UsageProvider
  usage: ProviderUsage | undefined
  failed: boolean
  now: number
  onOpen: () => void
  onDismiss: () => void
}) {
  return (
    <div
      data-strip='tray'
      className='flex flex-col gap-2 rounded-t-md border border-b-0 border-border bg-(--strip-bg) px-3 py-2.5 text-sm'
    >
      <div className='flex min-h-5 min-w-0 items-center gap-2'>
        <ProviderGlyph provider={provider} className='size-3.5 text-muted-foreground' />
        <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
          {providerNames[provider]} usage
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon'
                className='-my-1'
                aria-label='Open Usage'
                onClick={onOpen}
              />
            }
          >
            <ArrowUpRight01Icon />
          </TooltipTrigger>
          <TooltipContent>Open Usage</TooltipContent>
        </Tooltip>
        <Button
          variant='ghost'
          size='icon'
          className='-my-1 -mr-1.5'
          aria-label='Dismiss usage'
          onClick={onDismiss}
        >
          <Cancel01Icon />
        </Button>
      </div>
      {usage ? (
        <UsageWindows usage={usage} now={now} compact />
      ) : failed ? (
        <p className='text-xs text-muted-foreground'>Usage unavailable.</p>
      ) : (
        <UsageSkeleton compact />
      )}
    </div>
  )
}
