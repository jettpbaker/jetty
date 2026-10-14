import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useOpenSubagent } from '@/state'
import { useToolOutputs } from '@/state/tool_outputs'
import { useState } from 'react'

import { ActivityChevron } from './activity_disclosure'
import { CountedResults, ThreadRow } from './jetty_result_rows'
import { JettyThreadRow, JettyToolGroup } from './jetty_tool_group'
import { jettyResultTools } from './jetty_tool_results'
import { RollingNumber } from './rolling_number'
import { RollingText } from './rolling_text'
import { SubagentGlyph, subagentGlyphState } from './subagent_glyph'
import { ToolCall, toolCallDetails } from './tool_call'
import {
  describeToolBatch,
  workEnded,
  type SubagentBatch,
  type ThreadBatch,
  type ToolBatch,
} from './work_model'

export function ToolGroup({ batch, threadId }: { batch: ToolBatch; threadId?: string }) {
  return batch.calls[0]?.jettyTool && jettyResultTools[batch.calls[0].jettyTool] ? (
    <CachedJettyToolGroup batch={batch} threadId={threadId} />
  ) : (
    <DefaultToolGroup batch={batch} threadId={threadId} />
  )
}

function CachedJettyToolGroup({ batch, threadId }: { batch: ToolBatch; threadId?: string }) {
  const ids = batch.calls.filter((call) => call.outputBytes !== undefined).map((call) => call.id)
  const outputs = useToolOutputs(threadId, ids)
  const cached = new Map(ids.map((id, index) => [id, outputs[index]]))
  const calls = batch.calls.map((call) => {
    const output = cached.get(call.id)
    return output === undefined ? call : { ...call, output, outputBytes: undefined }
  })
  return <JettyToolGroup batch={{ ...batch, calls }} />
}

function DefaultToolGroup({ batch, threadId }: { batch: ToolBatch; threadId?: string }) {
  const label = describeToolBatch(batch)
  const autoOpen =
    label.itemCount !== undefined &&
    (!batch.sealed || batch.calls.some((call) => !workEnded(call.status)))
  const [previousAutoOpen, setPreviousAutoOpen] = useState(autoOpen)
  const [open, setOpen] = useState(autoOpen)
  const [autoClosing, setAutoClosing] = useState(false)
  const [initialCalls] = useState(() => new Set(batch.calls.map((call) => call.id)))
  if (previousAutoOpen !== autoOpen) {
    setPreviousAutoOpen(autoOpen)
    setAutoClosing(!autoOpen && open)
    setOpen(autoOpen)
  }
  function onOpenChange(nextOpen: boolean) {
    setAutoClosing(false)
    setOpen(nextOpen)
  }
  const heading = (
    <>
      <span className='flex min-w-0 items-baseline gap-1'>
        <span className={cn('shrink-0', label.active && 'shimmer')}>{label.verb}</span>
        {label.itemCount !== undefined ? (
          <span className='inline-flex items-baseline gap-1'>
            <RollingNumber value={label.itemCount} className='font-mono' />
            <span>{label.countNoun}</span>
          </span>
        ) : label.target ? (
          <RollingText key={label.verb} className={cn(!label.prose && 'font-mono')}>
            {label.target}
          </RollingText>
        ) : null}
      </span>
      {label.notices.length > 0 && (
        <span
          className={cn(
            'shrink-0 text-xs',
            label.failed ? 'text-status-error' : 'text-muted-foreground'
          )}
        >
          {label.notices.map((notice, index) => (
            <span key={notice.status}>
              {index > 0 && ', '}
              <RollingNumber value={notice.count} className='font-mono' /> {notice.text}
            </span>
          ))}
        </span>
      )}
    </>
  )
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='activity-header'
        aria-label={`${label.verb} ${label.target}${label.noticeText ? `, ${label.noticeText}` : ''}`}
      >
        {heading}
        <ActivityChevron />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(autoClosing && 'work-batch-auto-close')}>
        {batch.calls.length === 1 && label.itemCount === undefined ? (
          toolCallDetails(batch.calls[0]!, threadId)
        ) : (
          <div className='pl-2'>
            {batch.calls.map((call) => (
              <ToolCall
                key={call.id}
                call={call}
                threadId={threadId}
                animate={label.itemCount !== undefined && autoOpen && !initialCalls.has(call.id)}
              />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ThreadGroup({ batch }: { batch: ThreadBatch }) {
  return (
    <CountedResults verb='Created' count={batch.threads.length} noun='thread'>
      {batch.threads.map((thread) => (
        <JettyThreadRow
          key={thread.id}
          result={{ id: thread.threadId, title: thread.title ?? thread.threadId }}
        />
      ))}
    </CountedResults>
  )
}

export function SubagentGroup({ threadId, batch }: { threadId: string; batch: SubagentBatch }) {
  const open = useOpenSubagent()
  const active = batch.agents.some((agent) => agent.status === 'running')
  return (
    <CountedResults
      verb={active ? 'Starting' : 'Started'}
      count={batch.agents.length}
      noun='subagent'
      active={active}
      autoOpen={active}
    >
      {batch.agents.map((agent) => (
        <ThreadRow
          key={agent.id}
          result={{ id: agent.id, title: agent.title }}
          glyph={
            <SubagentGlyph
              state={subagentGlyphState(agent.status, agent.waiting)}
              className='size-3.25'
            />
          }
          onSelect={() => open(threadId, agent.id)}
        />
      ))}
    </CountedResults>
  )
}
