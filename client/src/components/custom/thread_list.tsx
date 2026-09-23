import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'
import type { TurnOutcome } from '@jetty/shared/reducer'

import { AssistantMessage } from '@/components/custom/assistant_message'
import { CreatedThreads } from '@/components/custom/child_threads'
import { ErrorMessage } from '@/components/custom/error_message'
import { GalleryMessage } from '@/components/custom/gallery_message'
import { MediaLightboxProvider } from '@/components/custom/media_lightbox'
import { SubagentGroup } from '@/components/custom/subagent_group'
import { clearTextMeasure, estimateRow } from '@/components/custom/thread_measure'
import {
  threadRows,
  toSubagent,
  type SubagentItem,
  type ThreadRow,
} from '@/components/custom/thread_rows'
import { TranscriptMarker } from '@/components/custom/transcript_marker'
import { UserMessage } from '@/components/custom/user_message'
import { VideoMessage } from '@/components/custom/video_message'
import { WorkBlock } from '@/components/custom/work_block'
import { WorkflowGroup } from '@/components/custom/workflow_group'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { useRevealRow } from '@/state'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const pinSlack = 96

function contentWidth(scrollerWidth: number) {
  return Math.max(1, Math.min(708, scrollerWidth) - 48)
}

function rowStamp(row: ThreadRow) {
  switch (row.kind) {
    case 'assistant':
    case 'plan':
      return `${row.item.text.length}:${row.streaming}`
    case 'user':
      return row.item.text.length
    case 'error':
      return row.message.length
    case 'gallery':
      return `${row.item.images.length}:${row.item.caption?.length ?? 0}`
    case 'video':
      return row.item.caption?.length ?? 0
    case 'subagents':
      return row.agents.map((agent) => `${agent.id}:${agent.status}`).join(',')
    case 'workflow':
      return `${row.item.status}:${row.item.phases.length}:${row.item.agents.map((agent) => agent.state).join('')}`
    case 'created':
      return row.threadIds.join(',')
    case 'marker':
      return row.item.kind
    case 'work':
      return row.activities
        .map((activity) =>
          activity.type === 'thinking'
            ? `${activity.id}:${activity.summary.length}:${activity.status}`
            : `${activity.id}:${activity.output?.length ?? 0}:${activity.status}`
        )
        .join(',')
  }
}

function SubagentsRow({
  agents,
  selectedId,
  onSelect,
}: {
  agents: readonly SubagentItem[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  const running = agents.some((agent) => agent.status === 'running')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return (
    <SubagentGroup
      agents={agents.map((agent) => toSubagent(agent, now))}
      defaultOpen
      selectedId={selectedId}
      onSelect={onSelect}
    />
  )
}

function ThreadItemRow({
  row,
  threadId,
  selectedAgent,
  onSelectAgent,
  provider,
  projectPath,
}: {
  row: ThreadRow
  threadId: string
  selectedAgent?: string
  onSelectAgent: (id: string) => void
  provider?: string
  projectPath?: string
}) {
  if (row.kind === 'user')
    return (
      <UserMessage text={row.item.text} attachments={row.item.attachments} from={row.item.from} />
    )
  if (row.kind === 'assistant' || row.kind === 'plan')
    return (
      <Message align='start'>
        <MessageContent>
          <Bubble variant='ghost' align='start'>
            <BubbleContent>
              {row.kind === 'plan' && <p className='mb-1 text-xs text-muted-foreground'>Plan</p>}
              <AssistantMessage text={row.item.text} streaming={row.streaming} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  if (row.kind === 'work')
    return (
      <WorkBlock
        activities={row.activities}
        status={row.status}
        elapsedSeconds={row.elapsedSeconds}
      />
    )
  if (row.kind === 'subagents')
    return <SubagentsRow agents={row.agents} selectedId={selectedAgent} onSelect={onSelectAgent} />
  if (row.kind === 'workflow') return <WorkflowGroup threadId={threadId} workflow={row.item} />
  if (row.kind === 'created') return <CreatedThreads parentId={threadId} ids={row.threadIds} />
  if (row.kind === 'error') return <ErrorMessage message={row.message} />
  if (row.kind === 'gallery')
    return <GalleryMessage images={row.item.images} caption={row.item.caption} />
  if (row.kind === 'video')
    return <VideoMessage video={row.item.video} caption={row.item.caption} />
  return (
    <TranscriptMarker
      item={row.item}
      source={row.source}
      provider={provider}
      projectPath={projectPath}
    />
  )
}

export function ThreadList({
  threadId,
  items,
  status,
  running,
  outcomes,
  projectPath,
  provider,
  agentId,
  onSelectAgent,
}: {
  threadId: string
  items: readonly ThreadItem[]
  status: SessionStatus
  running: boolean
  outcomes?: Readonly<Record<string, TurnOutcome>>
  projectPath?: string
  provider?: string
  agentId?: string
  onSelectAgent: (id: string) => void
}) {
  const rows = useMemo(
    () => threadRows(items, { status, running, outcomes, projectPath, agentId }),
    [items, status, running, outcomes, projectPath, agentId]
  )
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [width, setWidth] = useState(660)
  const [, setFontsReady] = useState(false)

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(contentWidth(element.clientWidth)))
    observer.observe(element)
    setWidth(contentWidth(element.clientWidth))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    void document.fonts.ready.then(() => {
      clearTextMeasure()
      // Re-render so the virtualizer re-estimates unmeasured rows with the loaded font.
      setFontsReady(true)
    })
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => estimateRow(rows[index]!, width),
    overscan: 10,
    gap: 12,
    paddingStart: 24,
    paddingEnd: 24,
    getItemKey: (index) => rows[index]!.id,
  })

  const stamp = rows.map(rowStamp).join('|')

  useLayoutEffect(() => {
    if (!pinned.current || rows.length === 0) return
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [virtualizer, rows.length, stamp, width])

  const [revealId, clearReveal] = useRevealRow(threadId)
  useEffect(() => {
    if (!revealId || agentId) return
    const index = rows.findIndex((row) => row.id === revealId)
    if (index === -1) return
    clearReveal()
    pinned.current = false
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [revealId, agentId, rows, virtualizer, clearReveal])

  return (
    <MediaLightboxProvider>
      <section
        ref={scroller}
        className='scrollbar-subtle scroll-fade-y [scrollbar-gutter:stable_both-edges] min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none'
        aria-label='Conversation'
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the page does not scroll, so this scrollport has to be focusable
        tabIndex={0}
        onScroll={({ currentTarget: element }) => {
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < pinSlack
        }}
      >
        <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className='absolute top-0 left-0 w-full'
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className='mx-auto w-full max-w-[708px] px-6'>
                <ThreadItemRow
                  row={rows[virtualRow.index]!}
                  threadId={threadId}
                  selectedAgent={agentId}
                  onSelectAgent={onSelectAgent}
                  provider={provider}
                  projectPath={projectPath}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </MediaLightboxProvider>
  )
}
