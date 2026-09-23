import type { SessionStatus } from '@jetty/shared/events'

import { InProgressIcon } from '@/components/custom/in_progress_icon'
import { cn } from '@/lib/utils'

import { NeedsInputIcon, ErrorStatusIcon } from './circle_status_icon'

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

export const statusPresentation = {
  idle: { icon: null, label: 'Idle', color: 'text-muted-foreground' },
  working: { icon: InProgressIcon, label: 'Working', color: 'text-status-working' },
  'needs-attention': { icon: NeedsInputIcon, label: 'Needs input', color: 'text-status-attention' },
  error: { icon: ErrorStatusIcon, label: 'Error', color: 'text-status-error' },
}

export function ThreadStatusGlyph({
  status,
  className,
  iconClassName,
}: {
  status: ThreadStatus
  className?: string
  iconClassName?: string
}) {
  const { icon: Icon, label, color } = statusPresentation[status]
  if (!Icon) return null
  return (
    <span className={cn('flex shrink-0 items-center', color, className)} title={label}>
      <Icon aria-hidden='true' className={iconClassName} />
      <span className='sr-only'>{label}</span>
    </span>
  )
}
