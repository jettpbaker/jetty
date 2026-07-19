import type { ThreadItem } from '@jetty/shared/items'

import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Response } from '@/components/response'
import { ToolCallField, ToolRow } from '@/components/tool-row'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { UserMessage } from '@/components/user-message'
import { turnSpinnerVerb } from '@/lib/spinner-verb'
import { usePacedText } from '@/lib/use-paced-text'
import { cn } from '@/lib/utils'
import { memo } from 'react'

// The dock is the only place to act on an approval; the timeline just records
// where it landed as a slim tool-row-language line.
function ApprovalRow({ item }: { item: Extract<ThreadItem, { kind: 'approval' }> }) {
  const label =
    item.decision === 'allow' ? 'Approved' : item.decision === 'deny' ? 'Denied' : 'Awaiting approval'
  return (
    <div>
      <div className='flex w-full min-w-0 items-baseline gap-2 text-sm'>
        <span className={cn('shrink-0', item.decision ? 'text-foreground' : 'text-muted-foreground')}>
          {label}
        </span>
        <span className='min-w-0 flex-1'>
          <ToolCallField toolName={item.toolName} input={item.input} />
        </span>
      </div>
      {item.decision === 'deny' && item.deniedReason ? (
        <p className='mt-1 text-sm text-muted-foreground italic'>{item.deniedReason}</p>
      ) : null}
    </div>
  )
}

function AssistantMessage({ item }: { item: Extract<ThreadItem, { kind: 'assistant_message' }> }) {
  const text = usePacedText(item.text, item.streaming ?? false)
  // keep animating through the post-completion drain, not just while on the wire
  const animating = (item.streaming ?? false) || text.length < item.text.length
  return (
    <Message align='start'>
      <MessageContent>
        <Bubble variant='ghost' align='start'>
          <BubbleContent>
            <Response isAnimating={animating}>{text}</Response>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function ItemBody({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case 'user_message':
      return <UserMessage text={item.text} attachments={item.attachments} />
    case 'assistant_message':
      return <AssistantMessage item={item} />
    case 'reasoning':
      return (
        <Reasoning defaultOpen={false} isStreaming={item.streaming ?? false}>
          <ReasoningTrigger verb={turnSpinnerVerb(item.turnId)} />
          <ReasoningContent>{item.text}</ReasoningContent>
        </Reasoning>
      )
    case 'tool_call':
      return <ToolRow item={item} />
    case 'approval':
      return <ApprovalRow item={item} />
    case 'plan':
      return (
        <div className='rounded-md border p-4'>
          <Response>{item.text}</Response>
        </div>
      )
    case 'error':
      return (
        <Alert variant='destructive'>
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{item.message}</AlertDescription>
        </Alert>
      )
  }
}

export const TimelineItem = memo(function TimelineItem({
  item,
}: {
  item: ThreadItem
  threadId: string
}) {
  return <ItemBody item={item} />
})
