import type { SessionStatus } from '@jetty/shared/events'
import type { ComponentType, SVGProps } from 'react'

import { cn } from '@/lib/utils'
import { CircleSlashIcon } from '@primer/octicons-react'

import {
  DoneStatusIcon,
  ErrorStatusIcon,
  NeedsInputIcon,
  QueuedStatusIcon,
  SuccessStatusIcon,
} from './circle_status_icon'
import { InProgressIcon } from './in_progress_icon'

// One status vocabulary for threads, child threads and workflow agents.
export type Status =
  | 'idle'
  | 'working'
  | 'needs-attention'
  | 'error'
  | 'ready'
  | 'done'
  | 'stopped'
  | 'queued'
export type ThreadStatus = Extract<
  Status,
  'idle' | 'working' | 'needs-attention' | 'error' | 'ready'
>

export function threadStatus(status: SessionStatus, readyForReview = false): ThreadStatus {
  switch (status) {
    case 'idle':
      return readyForReview ? 'ready' : 'idle'
    case 'starting':
    case 'running':
      return 'working'
    case 'awaiting_approval':
      return 'needs-attention'
    case 'error':
      return 'error'
  }
}

export const statusPresentation: Record<
  Status,
  { icon: ComponentType<SVGProps<SVGSVGElement>> | null; label: string; color: string }
> = {
  idle: { icon: null, label: 'Idle', color: 'text-muted-foreground' },
  working: { icon: InProgressIcon, label: 'Working', color: 'text-status-working' },
  'needs-attention': { icon: NeedsInputIcon, label: 'Needs input', color: 'text-status-attention' },
  error: { icon: ErrorStatusIcon, label: 'Error', color: 'text-status-error' },
  ready: { icon: SuccessStatusIcon, label: 'Ready for review', color: 'text-status-success' },
  done: { icon: DoneStatusIcon, label: 'Finished', color: 'text-status-success' },
  stopped: { icon: CircleSlashIcon, label: 'Stopped', color: 'text-muted-foreground' },
  queued: { icon: QueuedStatusIcon, label: 'Queued', color: 'text-muted-foreground' },
}

export function StatusGlyph({ status, className }: { status: Status; className?: string }) {
  const { icon: Icon, label, color } = statusPresentation[status]
  if (!Icon) return null
  return (
    <span
      className={cn('flex size-3.5 shrink-0 items-center justify-center', color, className)}
      title={label}
    >
      <Icon aria-hidden='true' className='size-full' />
      <span className='sr-only'>{label}</span>
    </span>
  )
}
