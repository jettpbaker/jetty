import type { ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { environments } from './composer_environment'
import { ThreadContextRing } from './context_ring'

// Environment and branch are fixed at first send.
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
      className='flex h-7 min-w-0 flex-1 items-center justify-between gap-1'
      aria-label={place || branch ? 'Environment and branch' : undefined}
    >
      {note ? (
        <div className='flex min-w-0 items-center px-2.25 text-xs text-muted-foreground'>
          {note}
        </div>
      ) : !place && !branch ? (
        <span />
      ) : (
        <Tooltip disabled={!place && !path}>
          <TooltipTrigger
            render={
              <div className='flex min-w-0 cursor-default items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground select-none' />
            }
          >
            {place && <place.Icon className='size-3 shrink-0' />}
            <span
              className={cn(
                'max-w-40 truncate @max-[600px]/composer:max-w-24',
                branch && 'font-mono'
              )}
            >
              {branch && place && <span className='sr-only'>{place.label} </span>}
              {branch ?? place?.label}
            </span>
          </TooltipTrigger>
          <TooltipContent align='start' className='max-w-lg'>
            <span className='flex flex-col'>
              {place && <span>{place.label}</span>}
              {branch && <span className='font-mono'>{branch}</span>}
              {path && <span className='font-mono text-muted-foreground'>{path}</span>}
            </span>
          </TooltipContent>
        </Tooltip>
      )}
      {ring && <ThreadContextRing threadId={threadId} provider={provider} />}
    </div>
  )
}
