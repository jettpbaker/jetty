import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { use, type ReactNode } from 'react'

import './charmed_icons.css'
import { basename, CharmedFileIcon } from './diff/file_name'
import { copyFilePath, OpenFileLink, ProjectFileRoot, projectRelativePath } from './file_link'
import { ArrowDown01Icon } from './huge_icons'
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
              ? 'Waiting for output'
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

export function ToolCall({ call, animate = false }: { call: ToolActivity; animate?: boolean }) {
  const root = use(ProjectFileRoot)
  const openFile = use(OpenFileLink)
  const label = describeToolBatch({ type: 'tools', id: call.id, calls: [call], sealed: true })
  if (root && call.files?.length)
    return (
      <div className={animate ? 'work-batch-enter' : undefined}>
        {call.files.map((file) => {
          const path = projectRelativePath(file, root)
          return (
            <Collapsible key={file}>
              <div className='activity-header activity-file-row'>
                {call.status === 'failed' && (
                  <span className='shrink-0 text-status-error'>{label.verb}</span>
                )}
                {path ? (
                  <Button
                    variant='link'
                    size='sm'
                    className='min-w-0 flex-1 justify-start gap-1.5 px-0 text-13 font-normal'
                    title={path}
                    aria-label={`Open ${path}`}
                    onClick={() => {
                      if (!openFile({ path }, 'file')) copyFilePath(path)
                    }}
                  >
                    <span data-charmed='soft' className='inline-flex size-4 shrink-0'>
                      <CharmedFileIcon path={path} inline />
                    </span>
                    <span className='truncate font-mono'>{basename(path)}</span>
                  </Button>
                ) : (
                  <span className='min-w-0 flex-1 truncate font-mono text-muted-foreground'>
                    {file}
                  </span>
                )}
                <CollapsibleTrigger
                  render={<Button variant='ghost' size='icon-sm' />}
                  aria-label={`Tool details for ${path ?? file}`}
                >
                  <ArrowDown01Icon />
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className='pl-2'>
                <ToolCallDetails call={call} />
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>
    )
  return (
    <Collapsible className={animate ? 'work-batch-enter' : undefined}>
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
              <span className={cn(label.active && 'shimmer')}>{label.verb}</span>{' '}
              <span className={cn('truncate', !call.words && 'font-mono')}>{call.target}</span>
            </>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className='pl-2'>
        <ToolCallDetails call={call} />
      </CollapsibleContent>
    </Collapsible>
  )
}
