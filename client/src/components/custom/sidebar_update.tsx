import type { AtomRegistry } from 'effect/reactivity'

import { ArrowUpCircleIcon, CircleXIcon } from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useChrome } from '@/state/chrome'
import { run, useAction } from '@/state/connection'
import { Effect } from 'effect'
import { useState } from 'react'

import { threadStatus } from './thread_status'

function requestUpdate(registry: AtomRegistry.AtomRegistry, failed: (reason: string) => void) {
  return run(registry, (connection) =>
    connection
      .request('jetty.update', {})
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => failed('message' in error ? error.message : String(error)))
        )
      )
  )
}

export function SidebarUpdate() {
  const chrome = useChrome()
  const remote = chrome?.jettyUpdate
  const [pending, setPending] = useState<typeof remote>()
  const [before, setBefore] = useState<typeof remote>()
  const update = useAction(requestUpdate)
  const state = remote === before ? (pending ?? remote) : remote
  if (!state) return null
  const failed = state.status === 'failed'
  const busy = state.status === 'updating' || state.status === 'restarting'
  const working =
    chrome?.threads.filter(
      (thread) =>
        !thread.archived && threadStatus(thread.status, thread.readyForReview) === 'working'
    ).length ?? 0
  const button = (
    <Button
      variant='ghost'
      disabled={busy}
      className={cn(
        'h-7 w-full justify-start gap-2 rounded-[6px] border-0 px-2.5 text-[13px] leading-5 font-medium',
        failed
          ? 'bg-destructive/14 text-destructive not-disabled:hover:bg-destructive/20 not-disabled:hover:text-destructive'
          : 'bg-primary/14 text-primary not-disabled:hover:bg-primary/20 not-disabled:hover:text-primary disabled:text-primary disabled:[&_svg]:text-primary'
      )}
      onClick={() => {
        setBefore(remote)
        setPending({ status: 'updating' })
        update((error) => setPending({ status: 'failed', error }))
      }}
    >
      {busy ? <Spinner /> : failed ? <CircleXIcon filled /> : <ArrowUpCircleIcon />}
      <span>
        {failed
          ? "Couldn't update"
          : state.status === 'restarting'
            ? 'Restarting…'
            : busy
              ? 'Updating…'
              : 'Update Jetty'}
      </span>
      {(failed || (!busy && working > 0)) && (
        <span className='ml-auto shrink-0 text-xs leading-4 font-normal text-muted-foreground'>
          {failed ? 'Try again' : `${working} working`}
        </span>
      )}
    </Button>
  )
  return (
    <div className='px-1.5 pt-1.5'>
      {failed ? (
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipContent>{state.error}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  )
}
