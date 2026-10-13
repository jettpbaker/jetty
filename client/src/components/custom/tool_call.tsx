import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { use, type ReactNode } from 'react'

import './charmed_icons.css'
import { ActivityChevron } from './activity_disclosure'
import { DiffCounts } from './diff/file_card'
import { basename, CharmedFileIcon } from './diff/file_name'
import { copyFilePath, OpenFileLink, ProjectFileRoot, projectRelativePath } from './file_link'
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
  const failed = call.status === 'failed'
  return (
    <div className='my-1 flex min-w-0 flex-col gap-3 rounded-sm border border-border bg-card p-3 text-xs'>
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
              : call.status === 'waiting'
                ? 'Waiting for approval'
                : failed
                  ? 'No error details were provided.'
                  : call.status === 'cancelled'
                    ? 'This call was cancelled. No output was received.'
                    : call.status === 'interrupted'
                      ? 'This call was stopped. No output was received.'
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
  const hasOutcomeDetails =
    call.status === 'failed' || call.status === 'cancelled' || call.status === 'interrupted'
  const description = call.kind === 'terminal' ? call.description?.trim() : undefined
  if (root && call.files?.length)
    return (
      <Collapsible className={animate ? 'work-raise-enter' : undefined}>
        {call.files.map((file) => {
          const path = projectRelativePath(file, root)
          const change = call.fileChange
          const showCounts =
            call.status === 'complete' &&
            (call.kind === 'edit' || call.kind === 'write') &&
            call.files?.length === 1 &&
            change &&
            (path ? projectRelativePath(change.path, root) === path : change.path === file) &&
            (change.additions > 0 || change.deletions > 0)
          return (
            <div key={file} className='activity-header activity-file-row'>
              <div className='flex min-w-0 items-center gap-2'>
                {path ? (
                  <Button
                    variant='link'
                    size='sm'
                    className='min-w-0 shrink justify-start gap-1.5 px-0 text-13 font-normal'
                    title={path}
                    aria-label={`Open ${path}`}
                    onClick={() => {
                      if (!openFile({ path })) copyFilePath(path)
                    }}
                  >
                    <span data-charmed='soft' className='inline-flex size-4 shrink-0'>
                      <CharmedFileIcon path={path} inline />
                    </span>
                    <span className='truncate font-mono'>{basename(path)}</span>
                  </Button>
                ) : (
                  <span className='min-w-0 truncate font-mono text-muted-foreground'>{file}</span>
                )}
                {showCounts && <DiffCounts files={[change]} hideZero />}
              </div>
              {hasOutcomeDetails && (
                <CollapsibleTrigger
                  render={<Button variant='ghost-text' size='sm' />}
                  className='activity-file-status gap-1 px-0 text-13 font-normal'
                  aria-label={`${label.verb}: ${path ?? file}`}
                >
                  <span className={cn(call.status === 'failed' && 'text-status-error')}>
                    {label.verb}
                  </span>
                  <ActivityChevron />
                </CollapsibleTrigger>
              )}
            </div>
          )
        })}
        {hasOutcomeDetails && (
          <CollapsibleContent>
            <ToolCallDetails call={call} />
          </CollapsibleContent>
        )}
      </Collapsible>
    )
  return (
    <Collapsible className={animate ? 'work-raise-enter' : undefined}>
      <CollapsibleTrigger render={<Button variant='ghost-text' />} className='activity-header'>
        <span
          className={cn(
            'flex min-w-0 items-baseline gap-1',
            call.status === 'failed' && 'text-status-error'
          )}
        >
          {description ? (
            <span className={cn(label.active && 'shimmer')}>
              {hasOutcomeDetails && `${label.verb}: `}
              {description}
            </span>
          ) : (
            <>
              <span className={cn(label.active && 'shimmer')}>{label.verb}</span>{' '}
              <span className={cn('truncate', !call.words && 'font-mono')}>{call.target}</span>
            </>
          )}
        </span>
        <ActivityChevron />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ToolCallDetails call={call} />
      </CollapsibleContent>
    </Collapsible>
  )
}
