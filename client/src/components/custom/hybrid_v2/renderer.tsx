import { Button } from '@/components/ui/button'
import { useState } from 'react'

import type { TurnView } from './projection'

import { formatActivityDuration } from '../work_model'
import { TurnEntry } from './entry'
import { TurnLabelText } from './label'
import { PaintRoll } from './paint_roll'

export function TurnRenderer({
  view,
  previous,
  threadId,
  instant,
  onRevealComplete,
}: {
  view: TurnView
  previous?: TurnView
  threadId: string
  instant: boolean
  onRevealComplete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const open = !view.folded || expanded
  const arrivals = view.rows.filter((row) => !previous?.rows.some((before) => before.id === row.id))
  const handoffId = previous?.now && !view.now ? arrivals[0]?.id : undefined
  const duration = formatActivityDuration(view.elapsedSeconds)
  const rows = view.answer ? [...view.rows, view.answer] : view.rows
  return (
    <div
      data-work-turn={view.turnId}
      data-v2-turn
      data-v2-cursor={view.cursor ?? ''}
      data-v2-folded={view.folded}
    >
      <div data-flush-work>
        <Button
          data-flush
          variant='ghost-text'
          className='activity-header text-muted-foreground'
          aria-expanded={open}
          onClick={() => setExpanded(!expanded)}
        >
          <span>
            <span
              data-work-heading
              className={view.heading.text === 'Working' && !instant ? 'shimmer' : undefined}
            >
              {view.heading.text}
            </span>
            {duration && (
              <>
                {' '}
                for <span className='font-mono'>{duration}</span>
              </>
            )}
          </span>
        </Button>
        <div className='work-scroll'>
          <div>
            {rows.map((row) => (
              <TurnEntry
                key={row.id}
                row={row}
                answer={row.id === view.answer?.id}
                open={open || row.id === view.answer?.id}
                instant={instant}
                delay={
                  Math.max(
                    0,
                    arrivals.findIndex((arrival) => arrival.id === row.id)
                  ) * 50
                }
                fromNow={row.id === handoffId ? previous?.now?.text : undefined}
                reply={`${threadId}:${row.id}`}
                onRevealComplete={onRevealComplete}
              />
            ))}
            {view.now && (
              <div className='hybrid-now'>
                <div className='activity-header text-muted-foreground'>
                  <span className={instant ? undefined : 'shimmer'}>
                    {view.now.count === undefined ? (
                      <PaintRoll text={view.now.text} instant={instant} />
                    ) : (
                      <TurnLabelText label={view.now} shimmer={!instant} instant={instant} />
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
