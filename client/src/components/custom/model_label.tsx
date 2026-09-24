import type { ProviderModel } from '@jetty/shared/wire'

import { modelLabelText } from '@jetty/shared/model-name'

export function ModelLabel({ model }: { model: ProviderModel }) {
  return <>{modelLabelText(model)}</>
}
