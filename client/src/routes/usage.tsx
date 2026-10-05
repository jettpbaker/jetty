import type { ProviderUsage } from '@jetty/shared/wire'

import { UsagePage } from '@/components/custom/usage_limits'
import { useNow } from '@/hooks/use-now'
import {
  usageFreshMs,
  usageProviders,
  useProviderUsage,
  type UsageProvider,
} from '@/state/provider-usage'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/usage')({ component: Usage })

function Usage() {
  const { reads, loading, failed, refresh } = useProviderUsage()
  const providers = usageProviders()
  const usage: Partial<Record<UsageProvider, ProviderUsage>> = {}
  const at: number[] = []
  for (const provider of providers) {
    const read = reads[provider]
    if (!read) continue
    usage[provider] = read.usage
    at.push(read.at)
  }
  const now = Math.max(useNow(60_000), ...at)
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
      updatedAt={at.length ? Math.min(...at) : undefined}
      refreshing={providers.some((provider) => loading.has(provider))}
      failed={failed}
      onRefresh={() => refresh(providers)}
    />
  )
}
