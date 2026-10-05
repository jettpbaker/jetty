import { CheckListIcon } from '@/components/custom/huge_icons'
import { cn } from '@/lib/utils'
import { useRequestSectionReveal } from '@/state'
import { Fragment } from 'react'

import type { TodoUpdate } from './todo_model'

import { inlineLinkClass } from './entity_link'

// Sits in the scrolling work log, so it acts on click rather than press.
export function TodoLink({ threadId, update }: { threadId: string; update: TodoUpdate }) {
  const reveal = useRequestSectionReveal()
  const { created, moves, done, total } = update
  return (
    <div className='activity-header items-center'>
      <button
        type='button'
        className={cn(inlineLinkClass, 'flex min-w-0 items-center gap-1.5')}
        onClick={() => reveal(threadId, 'todos')}
      >
        <CheckListIcon className='size-3.5 shrink-0 text-muted-foreground' />
        {created !== undefined ? (
          <span className='truncate'>
            Created {created} todo{created === 1 ? '' : 's'}
          </span>
        ) : (
          <span className='flex min-w-0'>
            {moves.map(({ move, text }, index) => (
              <Fragment key={index}>
                {index > 0 && <span className='shrink-0 whitespace-pre'> · </span>}
                <span className='min-w-0 truncate'>
                  {index === 0 ? `${move[0]!.toUpperCase()}${move.slice(1)}` : move} {text}
                </span>
              </Fragment>
            ))}
          </span>
        )}
      </button>
      <span className='shrink-0 font-mono text-xs text-muted-foreground tabular-nums'>
        {done}/{total}
      </span>
    </div>
  )
}
