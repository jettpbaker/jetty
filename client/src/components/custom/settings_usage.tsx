import type { ProviderUsage } from '@jetty/shared/wire'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

import type { ProviderEnabled } from './settings_providers'

import { ProviderGlyph } from './provider_glyph'
import './settings_sections.css'
import './settings_usage.css'

type Window = ProviderUsage['windows'][number]

function usageResetLabel(resetsAt: number, now: number): string {
  const minutes = Math.ceil((resetsAt - now) / 60_000)
  if (minutes <= 0) return 'Reset pending'
  if (minutes >= 1440)
    return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `Resets in ${minutes}m`
}

function Allowance({ usage, provider, now }: { usage: Window; provider: string; now: number }) {
  const percent = Math.round(usage.pct)
  const reset = usage.resetsAt && usageResetLabel(usage.resetsAt, now)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            className='rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
          />
        }
      >
        <div className='flex items-center justify-between gap-3 text-xs'>
          <span className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground'>
            <span className='min-w-12'>{usage.label}</span>
            {reset && (
              <span className='inline-flex items-center gap-1 tabular-nums' aria-label={reset}>
                <ArrowCounterClockwiseIcon aria-hidden='true' className='size-3' />
                {reset.replace(/^Resets in /, '')}
              </span>
            )}
          </span>
          <span className='tabular-nums'>{percent}% used</span>
        </div>
        <div
          role='meter'
          aria-label={`${provider} ${usage.label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent}% used`}
          className='mt-2 h-1 overflow-hidden rounded-full bg-accent'
        >
          <div
            className='h-full rounded-full bg-primary'
            style={{ width: `${Math.min(100, Math.max(0, usage.pct))}%` }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent className='flex-col items-start gap-1'>
        <span>{usage.label} allowance</span>
        {usage.resetsAt && (
          <span>
            Resets{' '}
            {new Date(usage.resetsAt).toLocaleString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short',
            })}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export function SettingsUsage({
  enabled,
  usage,
  failed,
}: {
  enabled: ProviderEnabled
  usage: readonly ProviderUsage[]
  failed: boolean
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const visible = usage.filter((item) => enabled[item.provider] && item.connected)
  if (visible.length === 0)
    return (
      <p className='text-xs text-muted-foreground'>
        {failed ? 'Usage unavailable.' : 'Loading usage…'}
      </p>
    )
  return (
    <div className='settings-usage'>
      {failed && <p className='text-xs text-muted-foreground'>Unable to refresh usage.</p>}
      {visible.map((item) => (
        <div
          key={item.provider}
          className='settings-usage-provider'
          role='group'
          aria-label={`${item.provider} usage`}
        >
          <div className='flex items-center gap-2.5'>
            <ProviderGlyph provider={item.provider} className='size-5 text-muted-foreground' />
            <div className='flex min-w-0 flex-1 items-center justify-between gap-3'>
              <h3 className='text-13 text-muted-foreground'>
                {item.provider === 'claude' ? 'Claude' : 'Codex'}
              </h3>
              {item.plan && <span className='text-xs text-muted-foreground'>{item.plan}</span>}
            </div>
          </div>
          {item.windows.length ? (
            <div className='settings-usage-windows'>
              {item.windows.map((window) => (
                <Allowance key={window.id} usage={window} provider={item.provider} now={now} />
              ))}
            </div>
          ) : (
            <p className='text-xs text-muted-foreground'>Usage unavailable.</p>
          )}
        </div>
      ))}
    </div>
  )
}
