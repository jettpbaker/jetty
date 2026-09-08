import type { ThreadEvent } from '@jetty/shared/events'

import type { Attachments } from './attachments'

export type MediaToolHost = {
  attachments: Attachments
  projectPath: string
  turnId: () => string
  emit: (event: ThreadEvent, turnId: string) => void | Promise<void>
}
