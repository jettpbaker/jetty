import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useState } from 'react'

import { describeToolBatch, type ToolActivity } from './work_model'

export function ToolCallDetails({ call }: { call: ToolActivity }) {
  return (
    <div className='mx-2 my-1 flex min-w-0 flex-col gap-3 rounded-sm border border-border bg-card p-3 text-xs'>
      {call.input !== undefined && (
        <section>
          <h4 className='mb-1 text-muted-foreground'>Input</h4>
          <pre
            className='tool-output'
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- tool output scrolls; keyboard users need focus to scroll it
            tabIndex={0}
          >
            {call.input}
          </pre>
        </section>
      )}
      <section>
        <h4 className='mb-1 text-muted-foreground'>
          {call.error ? 'Error' : call.kind === 'edit' ? 'Changes' : 'Output'}
        </h4>
        {call.error ? (
          <pre
            className='tool-output text-status-error'
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- tool output scrolls; keyboard users need focus to scroll it
            tabIndex={0}
          >
            {call.error}
          </pre>
        ) : call.output ? (
          <pre
            className='tool-output'
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- tool output scrolls; keyboard users need focus to scroll it
            tabIndex={0}
          >
            {call.output}
          </pre>
        ) : (
          <p className='text-muted-foreground'>
            {call.status === 'running'
              ? 'Waiting for output…'
              : call.status === 'waiting'
                ? 'Waiting for approval.'
                : call.status === 'cancelled' || call.status === 'interrupted'
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
  const [open, setOpen] = useState(false)
  const label = describeToolBatch({ type: 'tools', id: call.id, calls: [call], sealed: true })
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant='ghost-text' />} className='activity-header'>
        <span
          className={cn(
            'flex min-w-0 items-baseline gap-1',
            call.status === 'failed' && 'text-status-error'
          )}
        >
          {label.description ? (
            <span className={cn(label.active && 'shimmer')}>{label.description}</span>
          ) : (
            <>
              <span className={cn(label.active && 'shimmer', label.complete && 'text-foreground')}>
                {label.verb}
              </span>{' '}
              <span className='truncate font-mono'>{call.target}</span>
            </>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ToolCallDetails call={call} />
      </CollapsibleContent>
    </Collapsible>
  )
}
