import type { SessionStatus } from '@jetty/shared/events'
import type { ComponentType, SVGProps } from 'react'

import {
  ArchiveIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  Progress50Icon,
  QuestionmarkCircleIcon,
} from '@/components/custom/central_icons'
import { cn } from '@/lib/utils'

import { IdleIcon } from './idle_icon'

// One status vocabulary for threads, child threads and workflow agents.
export type Status =
  | 'monitoring'
  | 'idle'
  | 'working'
  | 'needs-attention'
  | 'error'
  | 'ready'
  | 'done'
  | 'stopped'
  | 'queued'
  | 'archived'
export type ThreadStatus = Extract<
  Status,
  'monitoring' | 'idle' | 'working' | 'needs-attention' | 'error' | 'ready'
>

// Only a thread that needs Jett (needs input, ready, or failed) keeps a foreground title in a list.
export const quietStatus = (status: Status) =>
  status !== 'error' && status !== 'ready' && status !== 'needs-attention'

export function threadStatus(status: SessionStatus, readyForReview = false): ThreadStatus {
  switch (status) {
    case 'monitoring':
      return 'monitoring'
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
  { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string; color: string }
> = {
  monitoring: { icon: ClockIcon, label: 'Waiting', color: 'text-status-idle' },
  idle: { icon: IdleIcon, label: 'Idle', color: 'text-status-idle' },
  working: { icon: Progress50Icon, label: 'Working', color: 'text-status-working' },
  'needs-attention': {
    icon: FilledQuestionmarkCircleIcon,
    label: 'Needs input',
    color: 'text-status-attention',
  },
  error: { icon: FilledCircleXIcon, label: 'Error', color: 'text-status-error' },
  ready: { icon: FilledCircleCheckIcon, label: 'Ready for review', color: 'text-status-success' },
  done: { icon: FilledCircleCheckIcon, label: 'Finished', color: 'text-status-success' },
  // Stopped and queued aren't running and wait on no one, so they draw the idle ring under their own names.
  stopped: { icon: IdleIcon, label: 'Stopped', color: 'text-status-idle' },
  archived: { icon: ArchiveIcon, label: 'Archived', color: 'text-muted-foreground' },
  queued: { icon: IdleIcon, label: 'Queued', color: 'text-status-idle' },
}

function FilledQuestionmarkCircleIcon(props: SVGProps<SVGSVGElement>) {
  return <QuestionmarkCircleIcon filled {...props} />
}

function FilledCircleXIcon(props: SVGProps<SVGSVGElement>) {
  return <CircleXIcon filled {...props} />
}

function FilledCircleCheckIcon(props: SVGProps<SVGSVGElement>) {
  return <CircleCheckIcon filled {...props} />
}

export function StatusGlyph({ status, className }: { status: Status; className?: string }) {
  const { icon: Icon, label, color } = statusPresentation[status]
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
