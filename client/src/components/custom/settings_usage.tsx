import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { providerLogoPath } from '@/lib/provider-logo'
import { createUsagePreview, usageResetLabel, type UsageWindow } from '@/lib/provider-usage'
import { ArrowCounterClockwiseIcon, ArrowUpRightIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

import './settings_usage.css'

function Allowance({
  usage,
  provider,
  now,
}: {
  usage: UsageWindow
  provider: string
  now: number
}) {
  const percent = usage.usedPercent === null ? null : Math.min(100, Math.max(0, usage.usedPercent))
  const reset = usageResetLabel(usage.resetsAt, now)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            className='settings-usage-window rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
          />
        }
      >
        <div className='flex items-center justify-between gap-3 text-xs'>
          <span className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground'>
            <span className='min-w-12'>{usage.label}</span>
            <span className='inline-flex items-center gap-1 tabular-nums' aria-label={reset}>
              <ArrowCounterClockwiseIcon aria-hidden='true' className='size-3' />
              {reset.replace(/^Resets in /, '')}
            </span>
          </span>
          <span className='tabular-nums'>
            {percent === null ? 'Unavailable' : `${percent}% used`}
          </span>
        </div>
        <div
          role='meter'
          aria-label={`${provider} ${usage.label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          aria-valuetext={percent === null ? 'Usage unavailable' : `${percent}% used`}
          className='mt-2 h-1 overflow-hidden rounded-full bg-accent'
        >
          {percent !== null && (
            <div className='h-full rounded-full bg-primary' style={{ width: `${percent}%` }} />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className='flex-col items-start gap-1'>
        <span>{usage.scope}</span>
        {usage.resetsAt !== null && (
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

export function SettingsUsage({ onConnectCopilot }: { onConnectCopilot: () => void }) {
  const [now, setNow] = useState(Date.now)
  const [providers] = useState(() => createUsagePreview(Date.now()))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className='settings-usage'>
      {providers.map((provider) => (
        <div
          key={provider.id}
          className='settings-usage-provider'
          role='group'
          aria-label={`${provider.name} usage`}
        >
          <div className='flex items-center gap-2.5'>
            <span
              aria-hidden='true'
              className={`size-5 shrink-0 ${provider.id === 'copilot' ? 'bg-disabled-foreground' : 'bg-muted-foreground'}`}
              style={{
                maskImage: `url(${providerLogoPath(provider.id)})`,
                maskSize: 'contain',
                maskPosition: 'center',
                maskRepeat: 'no-repeat',
              }}
            />
            <div className='flex min-w-0 flex-1 items-center justify-between gap-3'>
              <h3
                className={`text-13 ${provider.id === 'copilot' ? 'text-disabled-foreground' : 'text-muted-foreground'}`}
              >
                {provider.name}
              </h3>
              {provider.id === 'copilot' ? (
                <Button
                  variant='ghost-text'
                  size='sm'
                  className='-mr-2 h-7 gap-1 rounded-sm px-2 text-xs'
                  aria-label='Connect Copilot to view usage'
                  onClick={onConnectCopilot}
                >
                  Connect
                  <ArrowUpRightIcon className='size-3' />
                </Button>
              ) : (
                <span className='text-xs text-muted-foreground'>{provider.plan}</span>
              )}
            </div>
          </div>
          {provider.id === 'copilot' ? (
            <p className='text-xs text-muted-foreground'>
              Connect Copilot to see your usage and limits.
            </p>
          ) : (
            <div className='settings-usage-windows'>
              {provider.windows.map((usage) => (
                <Allowance key={usage.id} usage={usage} provider={provider.name} now={now} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
