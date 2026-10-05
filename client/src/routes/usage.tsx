import { loadProviderEnabled } from '@/components/custom/settings_providers'
import { UsagePage } from '@/components/custom/usage_limits'
import { useNow } from '@/hooks/use-now'
import { useProviderUsage } from '@/state/provider-usage'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/usage')({ component: Usage })

function Usage() {
  const { usage, loaded, loading, failed, updatedAt, refresh } = useProviderUsage()
  const now = Math.max(useNow(60_000), updatedAt ?? 0)
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  const enabled = loadProviderEnabled()
  return (
    <UsagePage
      usage={loaded && usage.length ? usage.filter((item) => enabled[item.provider]) : undefined}
      now={now}
      updatedAt={updatedAt}
      refreshing={loading}
      failed={failed}
      onRefresh={refresh}
    />
  )
}
