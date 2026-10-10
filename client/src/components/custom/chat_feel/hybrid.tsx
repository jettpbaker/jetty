import type { ThreadItem } from '@jetty/shared/items'
import type { Transition } from 'motion/react'

import { awaitsInput } from '@jetty/shared/items'
import { useEffect, useState } from 'react'

import type { ThreadRow } from '../thread_rows'

import { RollingText } from '../rolling_text'
import { describeToolBatch, workEnded, type WorkEntry } from '../work_model'
import { capyEase, capyMotion } from './capy'

export function hybridFold(open: boolean, reducedMotion: boolean | null): Transition {
  if (reducedMotion) return { duration: 0 }
  return open ? capyMotion(true, false) : { duration: 0.24, ease: capyEase }
}

export function hybridEntries(entries: readonly WorkEntry[]) {
  return entries.flatMap((entry): WorkEntry[] => {
    if (entry.type === 'thinking') return workEnded(entry.status) ? [entry] : []
    if (entry.type !== 'tools') return [entry]
    const calls = entry.calls.filter((call) => workEnded(call.status))
    if (calls.length === 0) return []
    return [calls.length === entry.calls.length ? entry : { ...entry, calls }]
  })
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
  const streaming = rows.some(
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
  const [idleReady, setIdleReady] = useState(false)
  const [shown, setShown] = useState(() => ({ label: activity, since: Date.now() }))

  useEffect(() => {
    setIdleReady(false)
    if (activity || hidden) return
    const timer = setTimeout(() => setIdleReady(true), 200)
    return () => clearTimeout(timer)
  }, [activity, hidden])

  const target = activity ?? (idleReady ? 'Planning next moves' : null)
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
      <RollingText textClassName='shimmer'>{shown.label ?? ''}</RollingText>
    </div>
  )
}
