import type { ProviderUsage, UsageWindow } from '@jetty/shared/wire'
import type { ReactNode } from 'react'

import {
  ArrowUpRightIcon,
  ChevronRightSmallIcon,
  CrossSmallIcon,
  ArrowRotateClockwiseIcon,
} from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Link } from '@tanstack/react-router'

import { PageSidebarTrigger } from './page_sidebar_trigger'
import { ProviderGlyph } from './provider_glyph'
import './usage_limits.css'

export type UsageProvider = ProviderUsage['provider']

export const providerNames: Record<UsageProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  copilot: 'GitHub Copilot',
  opencode: 'OpenCode',
}

const minute = 60_000
const day = 1440 * minute
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

function usageColor(window: UsageWindow) {
  return window.pct >= 100
    ? 'text-destructive'
    : window.pct >= 90
      ? 'text-status-attention'
      : 'text-primary'
}

function usageWarningColor(window: UsageWindow) {
  return window.pct >= 100 ? 'usage-text-exhausted' : 'usage-text-attention'
}

function UsageBar({ window, className }: { window: UsageWindow; className?: string }) {
  const left = percentLeft(window)
  return (
    <progress
      aria-label={`${window.label} usage`}
      value={100 - left}
      max={100}
      className={cn('usage-bar w-full', usageColor(window), className)}
    />
  )
}

// Hover or focus a window for its exact reset and whose limit it is.
function WindowTip({
  usage,
  window,
  className,
  children,
}: {
  usage: ProviderUsage
  window: UsageWindow
  className?: string
  children: ReactNode
}) {
  const who = [usage.plan, usage.account].filter(Boolean).join(' · ')
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus shows the window's reset time and account
            tabIndex={0}
            className={cn(
              'rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className='flex-col items-start gap-1'>
        {window.resetsAt !== undefined && <span>Resets {resetFormat.format(window.resetsAt)}</span>}
        {who && <span className='text-muted-foreground'>{who}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

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
  const warning =
    !compact && window.pct >= 100
      ? 'Usage limit reached'
      : !compact && window.pct >= 90
        ? 'Approaching usage limit'
        : undefined
  const note = [warning, pace].filter(Boolean).join(' · ')
  return (
    <WindowTip
      usage={usage}
      window={window}
      className={cn(
        'col-span-full grid grid-cols-subgrid items-center gap-y-1',
        !compact && 'min-h-8 py-1'
      )}
    >
      <span className='truncate text-xs text-muted-foreground'>{window.label}</span>
      <UsageBar window={window} className={compact ? 'h-0.75' : 'h-2'} />
      <span
        className={cn(
          'text-right text-xs',
          left <= 10 ? usageWarningColor(window) : 'text-foreground'
        )}
      >
        <span className='font-mono tabular-nums'>{100 - left}%</span>
        <span className={compact ? undefined : 'sr-only'}> used</span>
      </span>
      <span
        className={cn(
          'flex items-center justify-end gap-1 text-xs tabular-nums',
          left === 0 ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {reset && (
          <>
            <span className={compact ? undefined : 'sr-only'}>Resets in</span>
            <Mono>{reset}</Mono>
          </>
        )}
      </span>
      {note && (
        <span
          className={cn(
            'col-[2/-1] min-h-4 text-xs',
            warning ? usageWarningColor(window) : 'text-muted-foreground'
          )}
        >
          {note}
        </span>
      )}
    </WindowTip>
  )
}

function windowsGrid(compact: boolean) {
  return compact
    ? 'grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_4.25rem_7.5rem] gap-x-3 gap-y-2'
    : 'grid-cols-[minmax(0,8.75rem)_minmax(0,1fr)_3.5rem_5.25rem] gap-x-4 gap-y-1 @max-md:grid-cols-[minmax(0,5rem)_minmax(0,1fr)_3rem_6rem] @max-md:gap-x-3'
}

// Why a provider shows no windows, when it doesn't.
function missingWindows(usage: ProviderUsage) {
  if (usage.failed && usage.windows.length === 0) return 'Couldn’t read usage.'
  if (!usage.connected) return 'Not signed in.'
  if (usage.windows.length === 0) return 'No limits reported.'
  return undefined
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
  const missing = missingWindows(usage)
  if (missing) return <p className='text-xs text-muted-foreground'>{missing}</p>
  return (
    <div data-usage-provider={usage.provider} className={cn('grid', windowsGrid(compact))}>
      {usage.windows.map((window) => (
        <UsageRow key={window.id} usage={usage} window={window} now={now} compact={compact} />
      ))}
    </div>
  )
}

function UsageSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden='true' className={cn('grid items-center', windowsGrid(compact))}>
      {[0, 1].map((row) => (
        <div key={row} className='col-span-full grid h-4 grid-cols-subgrid items-center'>
          <Skeleton className='h-3 w-12 rounded-xs' />
          <Skeleton className={cn('rounded-full', compact ? 'h-0.75' : 'h-2')} />
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
  const unreported = providers.filter((provider) => {
    const item = usage[provider]
    return item?.connected && !item.failed && !failed.has(provider) && item.windows.length === 0
  })
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
                  onClick={onRefresh}
                />
              }
            >
              {refreshing ? <Spinner /> : <ArrowRotateClockwiseIcon />}
            </TooltipTrigger>
            <TooltipContent>Refresh usage</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div className='scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain'>
        <div className='@container mx-auto flex w-full max-w-160 flex-col gap-6 px-4 pt-4 pb-8'>
          <div
            aria-hidden='true'
            className={cn(
              'sticky top-0 z-1 grid bg-background py-3 text-xs text-muted-foreground',
              windowsGrid(false)
            )}
          >
            <span>Window</span>
            <span>Usage</span>
            <span className='text-right'>Used</span>
            <span className='text-right'>Resets in</span>
          </div>
          {providers
            .filter((provider) => !unreported.includes(provider))
            .map((provider) => {
              const item = usage[provider]
              return (
                <section
                  key={provider}
                  aria-labelledby={`usage-${provider}`}
                  aria-busy={item === undefined}
                  className='flex flex-col gap-2'
                >
                  <div className='flex items-center gap-2 text-muted-foreground'>
                    <ProviderGlyph provider={provider} className='size-4' />
                    <h2 id={`usage-${provider}`} className='text-sm font-semibold text-foreground'>
                      {providerNames[provider]}
                    </h2>
                    {item?.windows.some((window) => window.pct >= 90) && (
                      <Button
                        variant='outline'
                        size='xs'
                        className='ml-auto'
                        aria-label={`Manage ${providerNames[provider]} models`}
                        render={<Link to='/settings/$page' params={{ page: 'models' }} />}
                      >
                        Manage models
                        <ArrowUpRightIcon />
                      </Button>
                    )}
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
                    <p className='text-xs text-muted-foreground'>Couldn’t read usage.</p>
                  ) : (
                    <UsageSkeleton />
                  )}
                </section>
              )
            })}
          {unreported.length > 0 && (
            <p className='text-xs text-muted-foreground'>
              No limits reported: {unreported.map((provider) => providerNames[provider]).join(', ')}
            </p>
          )}
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
            <ArrowUpRightIcon />
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
          <CrossSmallIcon />
        </Button>
      </div>
      {usage ? (
        <UsageWindows usage={usage} now={now} compact />
      ) : failed ? (
        <p className='text-xs text-muted-foreground'>Couldn’t read usage.</p>
      ) : (
        <UsageSkeleton compact />
      )}
    </div>
  )
}

/* The context ring's popover: this thread's provider in full, each other connected one's tightest window */

function tightest(windows: readonly UsageWindow[]) {
  return windows.reduce((a, b) => (b.pct > a.pct ? b : a))
}

// "Weekly · Fable" is Fable's own window: its name is enough.
function windowName(window: UsageWindow) {
  return window.label.replace(/^Weekly · /, '')
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono tabular-nums', className)}>{children}</span>
}

function Rule() {
  return <Separator className='-mx-3 w-auto' />
}

function PlanHeading({
  provider,
  plan,
  children,
}: {
  provider: UsageProvider
  plan?: string
  children?: ReactNode
}) {
  return (
    <div className='flex items-center gap-1.5'>
      <ProviderGlyph provider={provider} className='size-3 text-muted-foreground' />
      <span className='font-medium'>{providerNames[provider]} limits</span>
      {plan && <span className='text-muted-foreground'>{plan}</span>}
      {children && <span className='ml-auto'>{children}</span>}
    </div>
  )
}

// Within a day, how long; further off, when. A clock time reads as words, like the pace line.
function ResetLabel({ window, now }: { window: UsageWindow; now: number }) {
  if (window.resetsAt === undefined) return null
  const wait = window.resetsAt - now
  return (
    <span className='text-muted-foreground tabular-nums'>
      {wait >= day ? (
        `Resets ${dayFormat.format(window.resetsAt)}`
      ) : (
        <>
          Resets in <Mono>{duration(wait)}</Mono>
        </>
      )}
    </span>
  )
}

function LimitLine({
  usage,
  window,
  label,
  now,
  pace = true,
}: {
  usage: ProviderUsage
  window: UsageWindow
  label: ReactNode
  now: number
  pace?: boolean
}) {
  const left = percentLeft(window)
  const note = pace ? paceOf(window, now) : undefined
  return (
    <WindowTip usage={usage} window={window} className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <span className='flex min-w-0 items-center gap-1.5'>{label}</span>
        <span className='flex shrink-0 items-center gap-2.5'>
          <ResetLabel window={window} now={now} />
          <span className={cn('w-16 text-right', left <= 10 && usageWarningColor(window))}>
            <Mono>{100 - left}%</Mono> used
          </span>
        </span>
      </div>
      <UsageBar window={window} className='block h-1' />
      {note && <span className='text-muted-foreground'>{note}</span>}
    </WindowTip>
  )
}

// A limit line's shape, until a provider's first read lands. Accent, the bars' track: muted
// disappears into the popover.
function LimitSkeleton() {
  return (
    <div aria-hidden='true' className='flex flex-col gap-1.5'>
      <div className='flex h-4 items-center'>
        <Skeleton className='h-3 w-12 rounded-xs bg-accent' />
      </div>
      <Skeleton className='h-1 rounded-full bg-accent' />
    </div>
  )
}

// A read that failed keeps its last good windows, with their age beside the plan.
export function RingLimits({
  provider,
  others,
  usage,
  failed,
  now,
}: {
  provider: UsageProvider
  others: readonly UsageProvider[]
  usage: Partial<Record<UsageProvider, ProviderUsage>>
  // the providers whose latest read failed
  failed: ReadonlySet<UsageProvider>
  now: number
}) {
  const plan = usage[provider]
  const missing = plan && missingWindows(plan)
  const stale = plan && (plan.failed || failed.has(provider)) && plan.windows.length > 0
  const connected = others.flatMap((id) => {
    const item = usage[id]
    return item?.connected && item.windows.length > 0 ? [item] : []
  })
  return (
    <>
      <Rule />
      <div className='flex flex-col gap-3'>
        <PlanHeading provider={provider} plan={plan?.plan}>
          {stale && plan.asOf !== undefined && (
            <span className='text-muted-foreground'>
              Updated <Mono>{duration(now - plan.asOf)}</Mono> ago
            </span>
          )}
        </PlanHeading>
        {plan ? (
          missing ? (
            <p className='text-muted-foreground'>{missing}</p>
          ) : (
            plan.windows.map((window) => (
              <LimitLine
                key={window.id}
                usage={plan}
                window={window}
                now={now}
                label={<span className='truncate text-muted-foreground'>{windowName(window)}</span>}
              />
            ))
          )
        ) : failed.has(provider) ? (
          <p className='text-muted-foreground'>Couldn’t read usage.</p>
        ) : (
          <>
            <LimitSkeleton />
            <LimitSkeleton />
          </>
        )}
      </div>
      {connected.length > 0 && (
        <>
          <Rule />
          <Collapsible>
            <CollapsibleTrigger
              render={
                <Button
                  variant='ghost-text'
                  size='sm'
                  className='group h-8 w-full justify-start px-0 font-normal'
                />
              }
            >
              <ChevronRightSmallIcon className='group-aria-expanded:rotate-90' />
              Other accounts
              <span className='ml-auto font-mono text-muted-foreground'>{connected.length}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className='flex flex-col gap-3 pt-2'>
                {connected.map((item) => {
                  const window = tightest(item.windows)
                  return (
                    <LimitLine
                      key={item.provider}
                      usage={item}
                      window={window}
                      now={now}
                      pace={false}
                      label={
                        <>
                          <ProviderGlyph
                            provider={item.provider}
                            className='size-3 shrink-0 text-muted-foreground'
                          />
                          <span>{providerNames[item.provider]}</span>
                          <span className='truncate text-muted-foreground'>
                            {windowName(window)}
                          </span>
                        </>
                      }
                    />
                  )
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
      <Link
        to='/usage'
        className='flex h-8 items-center gap-1 text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring'
      >
        All usage
        <ArrowUpRightIcon className='size-3' />
      </Link>
    </>
  )
}
