import { DitherAvatar } from '@/components/dither-kit/avatar'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'

import { OverflowTitle } from './overflow_title'

export const statusWash = {
  complete: 'linear-gradient(to right, var(--status-complete-wash), transparent)',
  error: 'linear-gradient(to right, var(--status-error-wash), transparent)',
} as const

export const subagentAvatarColor = {
  working: 'var(--primary)',
  complete: 'var(--tick-complete)',
  error: 'var(--status-error-glyph)',
  stopped: 'var(--muted-foreground)',
} as const

export type Subagent = {
  id: string
  title: string
  model: string
  effort?: string
  status: 'working' | 'complete' | 'error' | 'stopped'
  elapsedSeconds: number
  tokens: number
}

const tokenFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatSubagentTokens(tokens: number) {
  return tokenFormatter.format(tokens).toLowerCase()
}

export function renderWorkingTitle(title: string) {
  return <span className='shimmer text-muted-foreground'>{title}</span>
}

export function SubagentRow({
  agent,
  selected = false,
  onSelect,
}: {
  agent: Subagent
  selected?: boolean
  onSelect: () => void
}) {
  const status =
    agent.status === 'working'
      ? 'Working'
      : agent.status === 'complete'
        ? 'Complete'
        : agent.status === 'stopped'
          ? 'Stopped'
          : 'Error'
  return (
    <Button
      variant='ghost'
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${agent.title}, ${status}, ${agent.model}${agent.effort ? `, ${agent.effort}` : ''}`}
      data-overflow-hover
      className={cn(
        'grid h-auto w-full min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 gap-y-0.5 overflow-hidden rounded-menu-item px-2.5 py-1.5 text-left font-normal active:translate-y-0',
        selected && 'bg-accent'
      )}
      style={
        agent.status === 'working' || agent.status === 'stopped'
          ? undefined
          : { backgroundImage: statusWash[agent.status] }
      }
    >
      <span className='row-span-2 self-center' aria-hidden='true'>
        <DitherAvatar
          name={agent.id}
          mirror='horizontal'
          animate={false}
          bloom='subtle'
          color={subagentAvatarColor[agent.status]}
          className='block size-7'
        />
      </span>
      <OverflowTitle
        renderText={agent.status === 'working' ? renderWorkingTitle : undefined}
        focusable={false}
        className='font-normal leading-normal'
      >
        {agent.title}
      </OverflowTitle>
      <span
        className={cn(
          'text-right text-xs',
          agent.status === 'working'
            ? 'font-mono text-muted-foreground'
            : agent.status === 'error'
              ? 'text-status-error'
              : 'text-muted-foreground'
        )}
        aria-label={
          agent.status === 'working'
            ? `Running for ${formatDuration(agent.elapsedSeconds)}`
            : undefined
        }
      >
        {agent.status === 'working'
          ? formatDuration(agent.elapsedSeconds)
          : agent.status === 'complete'
            ? 'Finished'
            : agent.status === 'stopped'
              ? 'Stopped'
              : 'Failed'}
      </span>
      <span className='col-start-2 flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground'>
        <span className='truncate'>{agent.model}</span>
        {agent.effort && <span className='shrink-0'>{agent.effort}</span>}
      </span>
      <span
        className='text-right font-mono text-xs text-muted-foreground'
        aria-label={`${agent.tokens.toLocaleString('en')} token${agent.tokens === 1 ? '' : 's'}`}
      >
        {formatSubagentTokens(agent.tokens)}
      </span>
    </Button>
  )
}
