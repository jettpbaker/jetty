import { GitBranchIcon } from '@/components/custom/lucide_icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { environments } from './composer_environment'
import { ThreadContextRing } from './context_ring'

// The new thread's environment and branch pickers, locked at first send, with the context ring.
// Items keep the pickers' metrics so nothing moves when the new thread becomes this one.
export function ThreadFooter({
  threadId,
  environment,
  branch,
  path,
  ring,
}: {
  threadId: string
  environment?: 'local' | 'worktree'
  branch?: string
  path?: string
  ring: boolean
}) {
  const place = environment && environments[environment]
  return (
    <div
      className='relative z-10 flex h-7 items-center justify-between gap-1 px-2.5'
      aria-label='Environment and branch'
    >
      <Tooltip disabled={!path}>
        <TooltipTrigger
          render={
            <div className='flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground' />
          }
        >
          {place && (
            <span className='flex shrink-0 items-center gap-1.5 px-2.25'>
              <place.Icon className='size-3' />
              {place.label}
            </span>
          )}
          {branch && (
            <span className='flex min-w-0 items-center gap-1.5 px-2.25'>
              <GitBranchIcon className='size-3 shrink-0' />
              <span className='truncate'>{branch}</span>
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent align='start' className='max-w-lg'>
          {path}
        </TooltipContent>
      </Tooltip>
      {ring && <ThreadContextRing threadId={threadId} />}
    </div>
  )
}
