import type { ThreadMeta } from '@jetty/shared/wire'
import type { ReactNode } from 'react'

import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import { errorSurface } from './error_surface'
import { StatusGlyph } from './thread_status'
import { WorktreeSetupError } from './worktree_setup_error'

export function WorktreeSetupNotice({
  worktree,
  detail,
  children,
}: {
  worktree: NonNullable<ThreadMeta['worktree']>
  detail?: ReactNode
  children?: ReactNode
}) {
  const settingUp = worktree.state === 'pending' || worktree.state === 'setting_up'
  return (
    <div
      data-strip='worktree-setup'
      role={worktree.state === 'failed' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 bg-popover p-3 text-sm first:rounded-t-md',
        worktree.state === 'failed' && errorSurface
      )}
    >
      {settingUp ? (
        <Spinner className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
      ) : (
        <StatusGlyph
          status={worktree.state === 'failed' ? 'error' : 'stopped'}
          className='mt-0.5 size-4 shrink-0'
        />
      )}
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <span className='font-medium'>
          {settingUp
            ? 'Setting up worktree…'
            : worktree.state === 'failed'
              ? 'Worktree setup failed'
              : 'Worktree setup stopped'}
        </span>
        {detail && <span className='text-xs leading-5 text-muted-foreground'>{detail}</span>}
        {!settingUp && worktree.error && (
          <WorktreeSetupError error={worktree.error} stopped={worktree.state === 'stopped'} />
        )}
      </div>
      {children}
    </div>
  )
}
