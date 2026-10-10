import type { ThreadItem } from '@jetty/shared/items'
import type { Transition } from 'motion/react'

import { useChatSettled, useHybridLine } from '@/lib/chat-feel'
import { awaitsInput } from '@jetty/shared/items'
import { useEffect, useState } from 'react'

import type { ThreadRow } from '../thread_rows'

import { RollingText } from '../rolling_text'
import { describeToolBatch } from '../work_model'
import { capyEase, capyMotion } from './capy'

export function hybridFold(open: boolean, reducedMotion: boolean | null): Transition {
  if (reducedMotion) return { duration: 0 }
  return open ? capyMotion(true, false) : { duration: 0.24, ease: capyEase }
}

export function hybridActivity(
  rows: readonly ThreadRow[],
  items: readonly ThreadItem[],
  agentId?: string
) {
  const work = rows.findLast(
    (row) => row.kind === 'work' && (row.status === 'running' || row.status === 'waiting')
  )
  if (work?.kind !== 'work') return undefined
  const streaming = (work.flow ?? rows).some(
    (row) =>
      (row.kind === 'assistant' || row.kind === 'plan') &&
      row.item.turnId === work.turnId &&
      row.streaming
  )
  const pending = items.findLast(
    (item) => item.turnId === work.turnId && item.agentId === agentId && awaitsInput(item)
  )
  let activity: string | null = null
  if (pending || work.status === 'waiting') {
    activity = pending?.kind === 'question' ? 'Waiting for your answer' : 'Waiting for approval'
  } else {
    const activities = rows.flatMap((row) =>
      row.kind === 'work' && row.turnId === work.turnId ? row.activities : []
    )
    const tool = activities.findLast((entry) => entry.type === 'tool' && entry.status === 'running')
    if (tool?.type === 'tool') {
      const label = describeToolBatch({ type: 'tools', id: tool.id, calls: [tool], sealed: false })
      activity = tool.kind === 'web' ? label.verb : `${label.verb} ${label.target}`.trim()
    } else if (
      activities.some((entry) => entry.type === 'thinking' && entry.status === 'running')
    ) {
      activity = 'Thinking'
    }
  }
  return { workId: work.id, activity, streaming }
}

export function HybridNow({ activity, hidden }: { activity: string | null; hidden: boolean }) {
  const line = useHybridLine()
  hidden ||=
    (line === '2a' || line === 'both') && activity !== null && !activity.startsWith('Waiting for')
  const settled = useChatSettled()
  const [idleReady, setIdleReady] = useState(false)
  const [wasHidden, setWasHidden] = useState(hidden)
  const [shown, setShown] = useState(() => ({ label: activity, since: Date.now() }))

  useEffect(() => {
    setIdleReady(false)
    if (activity || hidden) return
    const timer = setTimeout(() => setIdleReady(true), 200)
    return () => clearTimeout(timer)
  }, [activity, hidden])

  const target = activity ?? (settled || idleReady ? 'Planning next moves' : null)
  if (settled && target !== shown.label) setShown({ label: target, since: Date.now() })
  if (hidden !== wasHidden) {
    setWasHidden(hidden)
    if (!hidden && target !== null && target !== shown.label) {
      setShown({ label: target, since: Date.now() })
    }
  }
  useEffect(() => {
    if (hidden || target === null || target === shown.label) return
    const delay = shown.label === null ? 0 : Math.max(0, 1200 - (Date.now() - shown.since))
    const timer = setTimeout(() => setShown({ label: target, since: Date.now() }), delay)
    return () => clearTimeout(timer)
  }, [hidden, target, shown])

  return (
    <div
      className='hybrid-now activity-header text-muted-foreground'
      hidden={hidden || shown.label === null}
    >
      {!hidden && shown.label !== null && (
        <RollingText textClassName='shimmer'>{shown.label}</RollingText>
      )}
    </div>
  )
}
