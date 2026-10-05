import type { BackgroundTask } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { formatElapsed } from '@/lib/time'
import { useStopBackgroundTasks } from '@/state/turns'
import { useState } from 'react'

import { WaitingStatusIcon } from './circle_status_icon'

export function MonitoringLine({
  threadId,
  tasks,
}: {
  threadId: string
  tasks: readonly BackgroundTask[]
}) {
  const [expanded, setExpanded] = useState(false)
  const now = useNow(60_000)
  const stopTasks = useStopBackgroundTasks()
  const many = tasks.length > 1
  const longest = now - Math.min(...tasks.map((task) => task.startedAt))
  return (
    <div className='flex flex-col px-2.5 text-xs'>
      <div className='relative flex h-7 min-w-0 items-center gap-3 rounded-sm pr-2.25 pl-1.75 hover:bg-accent/40'>
        {many && (
          <button
            type='button'
            aria-expanded={expanded}
            aria-label={`${tasks.length} background tasks`}
            onClick={() => setExpanded((value) => !value)}
            className='absolute inset-0 rounded-sm focus-visible:outline-2 focus-visible:outline-ring'
          />
        )}
        <span className='pointer-events-none flex shrink-0 items-center gap-1.5'>
          <span className='text-muted-foreground'>
            <WaitingStatusIcon className='size-3' />
          </span>
          <span className='text-foreground'>Monitoring</span>
        </span>
        <span className='pointer-events-none flex min-w-0 flex-1 items-center gap-1.5'>
          {expanded ? (
            <span className='text-muted-foreground'>{tasks.length} background tasks</span>
          ) : (
            <>
              <span className='truncate font-mono text-muted-foreground'>{tasks[0]!.label}</span>
              {many && <span className='shrink-0 text-muted-foreground'>+{tasks.length - 1}</span>}
            </>
          )}
        </span>
        <span className='pointer-events-none shrink-0 text-muted-foreground tabular-nums'>
          {formatElapsed(longest)}
        </span>
        <Button
          size='sm'
          variant='ghost'
          className='relative -mr-2.25 rounded-sm'
          onClick={() => stopTasks(threadId)}
        >
          {many ? 'Stop all' : 'Stop'}
        </Button>
      </div>
      {expanded && (
        <div className='flex flex-col pl-5'>
          {tasks.map((task) => (
            <div
              key={task.id}
              className='flex h-7 min-w-0 items-center gap-3 rounded-sm pr-2.25 pl-1.75 hover:bg-accent/40'
            >
              <span className='min-w-0 flex-1 truncate font-mono text-muted-foreground'>
                {task.label}
              </span>
              <span className='shrink-0 text-muted-foreground tabular-nums'>
                {formatElapsed(now - task.startedAt)}
              </span>
              <Button
                size='sm'
                variant='ghost'
                className='relative -mr-2.25 rounded-sm'
                onClick={() => stopTasks(threadId, task.id)}
              >
                Stop
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
