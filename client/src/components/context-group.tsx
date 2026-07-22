import type { ThreadItem } from '@jetty/shared/items'

import { pressHandlers } from '@/lib/press-handlers'
import { useState } from 'react'

import { ToolCallField, ToolRow, toolRunningLabel } from './tool-row'

export type ToolCallItem = Extract<ThreadItem, { kind: 'tool_call' }>

export const CONTEXT_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob'])

export function isContextCall(item: ThreadItem): item is ToolCallItem {
  return item.kind === 'tool_call' && CONTEXT_TOOLS.has(item.toolName) && item.status !== 'failed'
}

export type TimelineEntry =
  | { kind: 'single'; item: ThreadItem }
  | { kind: 'context-group'; items: ToolCallItem[] }

export function groupTimeline(items: ThreadItem[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]!
    if (!isContextCall(item)) {
      entries.push({ kind: 'single', item })
      i += 1
      continue
    }

    const group: ToolCallItem[] = [item]
    i += 1
    while (i < items.length) {
      const next = items[i]!
      if (!isContextCall(next)) break
      group.push(next)
      i += 1
    }
    entries.push({ kind: 'context-group', items: group })
  }
  return entries
}

function contextSummary(items: ToolCallItem[]): string {
  const filePaths = new Set<string>()
  let searches = 0

  for (const item of items) {
    if (item.toolName === 'Read') {
      const input = item.input
      if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
        const path = (input as Record<string, unknown>).file_path
        if (typeof path === 'string' && path.trim().length > 0) filePaths.add(path)
      }
      continue
    }
    if (item.toolName === 'Grep' || item.toolName === 'Glob') searches += 1
  }

  const parts: string[] = []
  if (filePaths.size === 1) parts.push('1 file read')
  else if (filePaths.size > 1) parts.push(`${filePaths.size} files read`)
  if (searches === 1) parts.push('1 search')
  else if (searches > 1) parts.push(`${searches} searches`)
  return parts.join(' · ')
}

export function ContextGroupRow({
  items,
  live = false,
}: {
  items: ToolCallItem[]
  live?: boolean
}) {
  const [open, setOpen] = useState(false)

  // Parallel calls can settle out of order — tick on the newest still-running one.
  let running: ToolCallItem | undefined
  for (const item of items) {
    if (item.status === 'running') running = item
  }

  // `live` = the turn is running and this group is the trailing timeline entry,
  // so the next tool call may still join it. Hold the ticker on the latest call
  // instead of flashing to the settled row between calls.
  const ticking = running ?? (live ? items[items.length - 1] : undefined)

  if (ticking) {
    return (
      <div className='flex w-full min-w-0 items-baseline gap-2 text-sm'>
        <span className='shrink-0 shimmer shimmer-duration-1000 text-muted-foreground'>
          {toolRunningLabel(ticking.toolName)}
        </span>
        <span className='min-w-0 flex-1'>
          <ToolCallField toolName={ticking.toolName} input={ticking.input} />
        </span>
      </div>
    )
  }

  if (items.length === 1) {
    return <ToolRow item={items[0]!} />
  }

  const summary = contextSummary(items)

  function toggle() {
    setOpen((value) => !value)
  }

  return (
    <div>
      <div
        className='flex w-full min-w-0 cursor-pointer select-none items-baseline gap-2 text-sm'
        {...pressHandlers(toggle)}
      >
        <span className='shrink-0 text-foreground'>Gathered context</span>
        {summary.length > 0 ? (
          <span className='min-w-0 flex-1 truncate text-muted-foreground'>{summary}</span>
        ) : (
          <span className='min-w-0 flex-1' />
        )}
      </div>
      {open ? (
        <div className='mt-2 flex flex-col gap-2'>
          {items.map((item) => (
            <ToolRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
