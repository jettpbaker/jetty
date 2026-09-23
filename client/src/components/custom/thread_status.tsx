import type { SessionStatus } from '@jetty/shared/events'

import { cn } from '@/lib/utils'

import { ErrorStatusIcon, NeedsInputIcon } from './circle_status_icon'
import { InProgressIcon } from './in_progress_icon'

export type ThreadStatus = 'idle' | 'working' | 'needs-attention' | 'error'

export function threadStatus(status: SessionStatus): ThreadStatus {
  switch (status) {
    case 'idle':
      return 'idle'
    case 'starting':
    case 'running':
      return 'working'
    case 'awaiting_approval':
      return 'needs-attention'
    case 'error':
      return 'error'
  }
}

const statusPresentation = {
  idle: { icon: null, label: 'Idle', color: 'text-muted-foreground' },
  working: { icon: InProgressIcon, label: 'Working', color: 'text-status-working' },
  'needs-attention': { icon: NeedsInputIcon, label: 'Needs input', color: 'text-status-attention' },
  error: { icon: ErrorStatusIcon, label: 'Error', color: 'text-status-error' },
}

export function ThreadStatusGlyph({
  status,
  iconClassName,
}: {
  status: ThreadStatus
  iconClassName: string
}) {
  const { icon: Icon, label, color } = statusPresentation[status]
  if (!Icon) return null
  return (
    <span className={cn('flex shrink-0 items-center', color)} title={label}>
      <Icon aria-hidden='true' className={iconClassName} />
      <span className='sr-only'>{label}</span>
    </span>
  )
}
