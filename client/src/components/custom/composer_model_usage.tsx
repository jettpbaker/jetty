import type { ProviderId } from '@jetty/shared/wire'

import { useNow } from '@/hooks/use-now'
import { formatUsageDuration } from '@/lib/provider-usage'
import { usageFreshMs, useProviderUsage } from '@/state/provider-usage'
import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'

export function ComposerModelUsage({
  provider,
  onNavigate,
}: {
  provider: ProviderId
  onNavigate: () => void
}) {
  const { reads, refresh, failed } = useProviderUsage()
  const now = useNow(60_000)
  useEffect(() => refresh([provider], usageFreshMs), [provider, refresh])
  const usage = reads[provider]?.usage
  if (!usage?.windows.length) return null
  const stale = failed.has(provider) || usage.failed
  return (
    <div className='flex flex-col gap-1 px-2 pt-1 pb-2 text-xs text-muted-foreground'>
      <div className='flex items-center justify-between gap-3'>
        <span>{stale ? 'Last known usage' : 'Account usage'}</span>
        <Link to='/usage' onClick={onNavigate} className='text-primary hover:underline'>
          View usage
        </Link>
      </div>
      {usage.windows.map((window) => (
        <p key={window.id} className='flex flex-wrap justify-between gap-x-2 gap-y-1'>
          <span>
            {window.label} · <span className='font-mono'>{Math.round(window.pct)}%</span> used
          </span>
          {window.resetsAt !== undefined && (
            <span>
              Resets{' '}
              {window.resetsAt <= now ? (
                'now'
              ) : (
                <>
                  in <span className='font-mono'>{formatUsageDuration(window.resetsAt - now)}</span>
                </>
              )}
            </span>
          )}
        </p>
      ))}
    </div>
  )
}
