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
import { useSmoothCount } from '@/lib/use-smooth-count'
import { cn } from '@/lib/utils'
import { memo } from 'react'

// The dock is the only place to act on an approval; the timeline just records
// where it landed as a slim tool-row-language line.
function ApprovalRow({ item }: { item: Extract<ThreadItem, { kind: 'approval' }> }) {
  const label =
    item.decision === 'allow'
      ? 'Approved'
      : item.decision === 'deny'
        ? 'Denied'
        : 'Awaiting approval'
  return (
    <div>
      <div className='flex w-full min-w-0 items-baseline gap-2 text-sm'>
        <span
          className={cn('shrink-0', item.decision ? 'text-foreground' : 'text-muted-foreground')}
        >
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

function ReasoningMessage({ item }: { item: Extract<ThreadItem, { kind: 'reasoning' }> }) {
  const text = usePacedText(item.text, item.streaming ?? false)
  const animating = (item.streaming ?? false) || text.length < item.text.length
  const tokens = useSmoothCount(item.tokens ?? 0)
  // Current models omit thinking text (JET-9): no text means nothing to
  // disclose, so render a plain status row — live token count while streaming,
  // bare past tense once settled.
  if (!item.text) {
    return (
      <div className='text-muted-foreground text-sm'>
        {item.streaming ? (
          <>
            <span className='shimmer shimmer-duration-1000'>{turnSpinnerVerb(item.turnId)}</span>
            {tokens > 0 ? (
              <span className='animate-in fade-in duration-300 motion-reduce:animate-none'>
                {' for '}
                <span className='font-mono text-code-foreground'>{tokens}</span>
                {' tokens'}
              </span>
            ) : null}
          </>
        ) : (
          <span>Reasoned</span>
        )}
      </div>
    )
  }
  return (
    <Reasoning defaultOpen={false} isStreaming={item.streaming ?? false}>
      <ReasoningTrigger verb={turnSpinnerVerb(item.turnId)} />
      <ReasoningContent isAnimating={animating}>{text}</ReasoningContent>
    </Reasoning>
  )
}

// The dock is where questions get answered; the timeline records the Q&A.
function QuestionRow({ item }: { item: Extract<ThreadItem, { kind: 'question' }> }) {
  return (
    <div className='flex flex-col gap-1 text-sm'>
      {item.questions.map((q) => (
        <div key={q.question} className='flex min-w-0 items-baseline gap-2'>
          <span className='shrink-0 text-muted-foreground'>{q.header}</span>
          <span className='min-w-0'>
            {item.answers?.[q.question] ||
              (item.skipped || item.answers ? 'Not answered' : 'Awaiting answer…')}
          </span>
        </div>
      ))}
    </div>
  )
}

function ItemBody({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case 'user_message':
      return <UserMessage text={item.text} attachments={item.attachments} />
    case 'assistant_message':
      return <AssistantMessage item={item} />
    case 'reasoning':
      return <ReasoningMessage item={item} />
    case 'tool_call':
      return <ToolRow item={item} />
    case 'approval':
      return <ApprovalRow item={item} />
    case 'question':
      return <QuestionRow item={item} />
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
