import type { BackgroundTask } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { formatDuration, formatElapsed } from '@/lib/time'
import { useStopBackgroundTasks } from '@/state/turns'

import { ClockIcon, ConsoleSimpleIcon } from './central_icons'

// A monitor or background command still running: what it is, how long, and a way to stop it.
export function RunningTaskRow({ threadId, task }: { threadId: string; task: BackgroundTask }) {
  const now = useNow(1000)
  const stopTasks = useStopBackgroundTasks()
  const elapsed = Math.max(0, now - task.startedAt)
  const Glyph = task.kind === 'monitor' ? ClockIcon : ConsoleSimpleIcon
  return (
    <div className='flex h-7 min-w-0 items-center gap-2 rounded-sm pr-1 pl-2.5 hover:bg-accent/40'>
      <Glyph className={task.kind === 'monitor' ? 'text-status-idle' : 'text-muted-foreground'} />
      <span className='min-w-0 flex-1 truncate font-mono text-xs'>{task.label}</span>
      <span className='shrink-0 font-mono text-xs text-muted-foreground tabular-nums'>
        {elapsed < 60_000 ? formatDuration(elapsed / 1000) : formatElapsed(elapsed)}
      </span>
      <Button
        variant='ghost-text'
        size='sm'
        className='font-normal'
        onClick={() => stopTasks(threadId, task.id)}
      >
        Stop
      </Button>
    </div>
  )
}
