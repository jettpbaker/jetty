import type { EffortLevel } from '@jetty/shared/events'
import type { ProviderModel } from '@jetty/shared/wire'

import { catalogModelName, formatModelLabel } from '@jetty/shared/model-name'

type ModelOptions = { effort?: EffortLevel; fast?: boolean }

export function ModelLabel({ model, ...options }: { model: ProviderModel } & ModelOptions) {
  return (
    <CatalogModelLabel catalog={[model]} provider={model.provider} model={model.id} {...options} />
  )
}

export function CatalogModelLabel({
  catalog,
  provider,
  model,
  effort,
  fast,
}: {
  catalog: readonly ProviderModel[] | undefined
  provider: string | undefined
  model: string | undefined
} & ModelOptions) {
  const name = catalogModelName(catalog, provider, model) ?? ''
  const label = formatModelLabel(catalog, provider, model, effort, fast)
  const version = provider === 'claude' ? name.indexOf(' ') : -1
  const end = version < 0 ? name.length : version
  return (
    <>
      <span className='text-foreground'>{label.slice(0, end)}</span>
      {label.length > end && <span className='text-muted-foreground'>{label.slice(end)}</span>}
    </>
  )
}
