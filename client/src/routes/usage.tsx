import { UsagePage } from '@/components/custom/usage_limits'
import { usageFreshMs, usageProviders, useUsageReads } from '@/state/provider-usage'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/usage')({ component: Usage })

function Usage() {
  const providers = usageProviders()
  const { usage, now, oldest, loading, failed, refresh } = useUsageReads(providers)
  useEffect(() => {
    function open() {
      refresh(usageProviders(), usageFreshMs)
    }
    open()
    const timer = window.setInterval(open, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  return (
    <UsagePage
      providers={providers}
      usage={usage}
      now={now}
      updatedAt={oldest}
      refreshing={providers.some((provider) => loading.has(provider))}
      failed={failed}
      onRefresh={() => refresh(providers)}
    />
  )
}
