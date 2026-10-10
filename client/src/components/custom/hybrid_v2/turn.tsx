import type { ThreadItem } from '@jetty/shared/items'

import { useChatSettled, useHybridLine, useInterimText } from '@/lib/chat-feel'
import { useCallback, useMemo, useState } from 'react'

import type { ThreadRow } from '../thread_rows'
import type { TurnView } from './projection'

import { projectTurn } from './projection'
import { TurnRenderer } from './renderer'

export function TurnSurface({
  work,
  answer,
  items,
  threadId,
  now,
}: {
  work: Extract<ThreadRow, { kind: 'work' }>
  answer?: Extract<ThreadRow, { kind: 'assistant' | 'plan' }>
  items?: readonly ThreadItem[]
  threadId: string
  now: number
}) {
  const instant = useChatSettled()
  const line = useHybridLine()
  const interim = useInterimText()
  const [revealed, setRevealed] = useState<string>()
  const revealComplete = useCallback(() => setRevealed(answer?.id), [answer?.id])
  const view = useMemo(
    () =>
      projectTurn({
        work,
        answer,
        items,
        revealDone: instant || revealed === answer?.id,
        line,
        interim,
        now,
      }),
    [work, answer, items, instant, revealed, line, interim, now]
  )
  const [last, setLast] = useState({ view, previous: undefined as TurnView | undefined })
  if (last.view !== view) setLast({ view, previous: instant ? undefined : last.view })
  return (
    <TurnRenderer
      view={view}
      previous={last.previous}
      threadId={threadId}
      instant={instant}
      onRevealComplete={revealComplete}
    />
  )
}
