import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

import { describeToolBatch, type ToolActivity } from './work_model'

function ToolOutput({ className, children }: { className?: string; children: ReactNode }) {
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- tool output scrolls; keyboard users need focus to scroll it
    <pre className={cn('tool-output', className)} tabIndex={0}>
      {children}
    </pre>
  )
}

export function ToolCallDetails({ call }: { call: ToolActivity }) {
  const failed = call.status === 'failed' && Boolean(call.output)
  return (
    <div className='mx-2 my-1 flex min-w-0 flex-col gap-3 rounded-sm border border-border bg-card p-3 text-xs'>
      {call.input !== undefined && (
        <section>
          <h4 className='mb-1 text-muted-foreground'>Input</h4>
          <ToolOutput>{call.input}</ToolOutput>
        </section>
      )}
      <section>
        <h4 className='mb-1 text-muted-foreground'>
          {failed ? 'Error' : call.kind === 'edit' ? 'Changes' : 'Output'}
        </h4>
        {call.output ? (
          <ToolOutput className={cn(failed && 'text-status-error')}>{call.output}</ToolOutput>
        ) : (
          <p className='text-muted-foreground'>
            {call.status === 'running'
              ? 'Waiting for output…'
              : call.status === 'waiting'
                ? 'Waiting for approval.'
                : call.status === 'cancelled'
                  ? 'No output received.'
                  : call.output === ''
                    ? 'Completed with no output.'
                    : 'Output unavailable.'}
          </p>
        )}
      </section>
    </div>
  )
}

export function ToolCall({ call }: { call: ToolActivity }) {
  const label = describeToolBatch({ type: 'tools', id: call.id, calls: [call], sealed: true })
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant='ghost-text' />} className='activity-header'>
        <span
          className={cn(
            'flex min-w-0 items-baseline gap-1',
            call.status === 'failed' && 'text-status-error'
          )}
        >
          <span className={cn(label.active && 'shimmer', label.complete && 'text-foreground')}>
            {label.verb}
          </span>{' '}
          <span className='truncate font-mono'>{call.target}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ToolCallDetails call={call} />
      </CollapsibleContent>
    </Collapsible>
  )
}
