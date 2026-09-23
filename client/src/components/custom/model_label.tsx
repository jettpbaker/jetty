import type { ProviderModel } from '@jetty/shared/wire'

import { claudeModelName } from '@jetty/shared/model-name'

export function ModelLabel({ model }: { model: ProviderModel }) {
  const name = model.provider === 'claude' ? claudeModelName(model.id, model.name) : model.name
  const extended = model.contextWindow === '1m' || /\[1m\]$/i.test(model.id)
  return (
    <>
      {name}
      {extended && (
        <span className='ml-1 text-muted-foreground' aria-label='1M context window'>
          1M
        </span>
      )}
    </>
  )
}
