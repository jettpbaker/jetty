import type { ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { environments } from './composer_environment'
import { ThreadContextRing } from './context_ring'

// The new thread's environment and branch, locked at first send, as the environment's icon and
// the branch, with the context ring. The icon sits where the environment picker's did.
export function ThreadFooter({
  threadId,
  environment,
  branch,
  path,
  provider,
  ring,
  note,
}: {
  threadId: string
  environment?: 'local' | 'worktree'
  branch?: string
  path?: string
  provider: string
  ring: boolean
  // A passing state, shown in the environment's place: editing a queued message.
  note?: ReactNode
}) {
  const place = environment && environments[environment]
  return (
    <div
      className='relative z-10 flex h-7 items-center justify-between gap-1 px-2.5'
      aria-label='Environment and branch'
    >
      {note ? (
        <div className='flex min-w-0 items-center px-2.25 text-xs text-muted-foreground'>
          {note}
        </div>
      ) : (
        <Tooltip disabled={!place && !path}>
          <TooltipTrigger
            render={
              <div className='flex min-w-0 cursor-default items-center gap-1.5 px-2.25 text-xs font-medium text-muted-foreground select-none' />
            }
          >
            {place && <place.Icon className='size-3 shrink-0' />}
            <span className='truncate'>
              {branch && place && <span className='sr-only'>{place.label} </span>}
              {branch ?? place?.label}
            </span>
          </TooltipTrigger>
          <TooltipContent align='start' className='max-w-lg'>
            <span className='flex flex-col'>
              {place && <span>{place.label}</span>}
              {path && <span className='text-muted-foreground'>{path}</span>}
            </span>
          </TooltipContent>
        </Tooltip>
      )}
      {ring && <ThreadContextRing threadId={threadId} provider={provider} />}
    </div>
  )
}
