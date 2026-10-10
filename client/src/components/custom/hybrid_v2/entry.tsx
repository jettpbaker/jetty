import { Button } from '@/components/ui/button'
import { useChatSettled, useInterimText } from '@/lib/chat-feel'
import { motion } from 'motion/react'
import { useState } from 'react'

import type { TurnRow } from './projection'

import { capyMotion } from '../chat_feel/capy'
import { Markdown } from '../markdown'
import { ToolCallDetails } from '../tool_call'
import { TranscriptMarker } from '../transcript_marker'
import { TurnLabelText } from './label'

function ActivityRow({
  row,
  instant,
  fromNow,
}: {
  row: TurnRow
  instant: boolean
  fromNow?: string
}) {
  const [details, setDetails] = useState(false)
  const [from] = useState(instant ? undefined : fromNow)
  const [handoff, setHandoff] = useState(from)
  if (instant && handoff) setHandoff(undefined)
  const entry = row.entry
  return (
    <div
      className={from ? 'hybrid-handoff rolling-text-window' : undefined}
      data-now-handoff={from}
      data-handoff-running={handoff ? '' : undefined}
    >
      <div className={from ? 'hybrid-handoff-row' : undefined}>
        <Button
          variant='ghost-text'
          className='activity-header text-muted-foreground'
          data-batch-tense={entry?.type === 'tools' ? 'open' : undefined}
          data-batch-open={entry?.type === 'tools' && !entry.sealed ? '' : undefined}
          aria-expanded={details}
          onClick={() => setDetails(!details)}
        >
          <span
            className={handoff ? 'rolling-text-in' : undefined}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && event.animationName === 'rolling-text-in')
                setHandoff(undefined)
            }}
          >
            <TurnLabelText label={row.label} shimmer={row.shimmer} instant={instant} />
          </span>
        </Button>
        {details && entry?.type === 'thinking' && (
          <div className='thinking-text'>
            <Markdown>{entry.summary}</Markdown>
          </div>
        )}
        {details &&
          entry?.type === 'tools' &&
          entry.calls.map((call) => <ToolCallDetails key={call.id} call={call} />)}
      </div>
      {handoff && (
        <div
          aria-hidden='true'
          className='activity-header absolute inset-x-0 top-0 text-muted-foreground'
        >
          <span className='rolling-text-out'>{handoff}</span>
        </div>
      )}
    </div>
  )
}

function TextRow({
  row,
  reply,
  answer,
  onRevealComplete,
}: {
  row: TurnRow
  reply: string
  answer: boolean
  onRevealComplete?: () => void
}) {
  const interim = useInterimText()
  const instant = useChatSettled()
  return (
    <div
      data-slot='message'
      data-interim-text={!answer && interim !== 'today' ? interim : undefined}
      data-interim-answer={answer && interim !== 'today' ? interim : undefined}
      data-interim-muted={row.muted ? '' : undefined}
      className={row.muted ? 'text-muted-foreground' : undefined}
    >
      <div data-slot='bubble-content' data-quote={row.id}>
        <Markdown
          key={instant ? 'settled' : 'live'}
          streaming={!instant && row.streaming}
          arrived={!instant}
          reply={reply}
          onRevealComplete={onRevealComplete}
        >
          {row.text ?? ''}
        </Markdown>
      </div>
    </div>
  )
}

export function TurnEntry({
  row,
  answer,
  open,
  instant,
  delay,
  fromNow,
  reply,
  onRevealComplete,
}: {
  row: TurnRow
  answer: boolean
  open: boolean
  instant: boolean
  delay: number
  fromNow?: string
  reply: string
  onRevealComplete: () => void
}) {
  const [arrival] = useState({ delay, handoff: fromNow })
  const [entered, setEntered] = useState(instant || fromNow !== undefined)
  return (
    <motion.div
      data-v2-id={row.id}
      data-v2-kind={row.kind}
      data-v2-row={answer ? undefined : row.id}
      data-v2-label={row.label.text}
      data-v2-tense={row.label.tense}
      data-v2-live={row.live}
      data-v2-running={row.runningCalls.join(',')}
      data-chat-row={row.kind === 'text' ? 'assistant' : undefined}
      aria-hidden={!open}
      inert={!open}
      className='overflow-hidden'
      initial={entered ? false : { height: 0, opacity: 0, y: 4 }}
      animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0, y: 0 }}
      transition={
        instant
          ? { duration: 0 }
          : { ...capyMotion(open, false), delay: entered ? 0 : arrival.delay / 1000 }
      }
      onAnimationComplete={() => setEntered(true)}
    >
      {row.kind === 'marker' && row.item ? (
        <TranscriptMarker item={row.item} />
      ) : row.kind === 'text' ? (
        <TextRow
          row={row}
          reply={reply}
          answer={answer}
          onRevealComplete={answer ? onRevealComplete : undefined}
        />
      ) : (
        <ActivityRow row={row} instant={instant} fromNow={arrival.handoff} />
      )}
    </motion.div>
  )
}
