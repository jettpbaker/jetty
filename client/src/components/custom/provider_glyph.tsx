import { providerLogoPath } from '@/lib/provider-logo'
import { cn } from '@/lib/utils'

import './provider_glyph.css'

export function ProviderGlyph({ provider, className }: { provider: string; className?: string }) {
  return (
    <span
      aria-hidden='true'
      data-provider={provider}
      className={cn('provider-icon', className)}
      style={{ maskImage: `url(${providerLogoPath(provider)})` }}
    />
  )
}
