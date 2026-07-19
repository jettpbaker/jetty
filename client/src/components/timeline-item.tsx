import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'

import { socket } from '@/app-state'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Response } from '@/components/response'
import { ToolRow } from '@/components/tool-row'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Message, MessageContent } from '@/components/ui/message'
import { UserMessage } from '@/components/user-message'
import { memo, useState } from 'react'
import { toast } from 'sonner'

function ApprovalCard({
  item,
  threadId,
}: {
  item: Extract<ThreadItem, { kind: 'approval' }>
  threadId: string
}) {
  const [pending, setPending] = useState(false)

  function respond(decision: ApprovalDecision) {
    setPending(true)
    void socket.request('approval.respond', { threadId, itemId: item.id, decision }).catch(() => {
      setPending(false)
      toast.error('Couldn’t respond to the approval.')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <Badge variant={item.decision === 'deny' ? 'destructive' : 'secondary'}>
          {item.decision ?? 'pending'}
        </Badge>
      </CardHeader>
      <CardContent className='text-muted-foreground text-sm'>{item.toolName}</CardContent>
      {item.decision === undefined ? (
        <CardFooter className='gap-2'>
          <Button disabled={pending} onClick={() => respond('allow')}>
            Allow
          </Button>
          <Button disabled={pending} variant='outline' onClick={() => respond('deny')}>
            Deny
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function ItemBody({ item, threadId }: { item: ThreadItem; threadId: string }) {
  switch (item.kind) {
    case 'user_message':
      return <UserMessage text={item.text} attachments={item.attachments} />
    case 'assistant_message':
      return (
        <Message align='start'>
          <MessageContent>
            <Bubble variant='ghost' align='start'>
              <BubbleContent>
                <Response>{item.text}</Response>
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )
    case 'reasoning':
      return (
        <Reasoning defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent>{item.text}</ReasoningContent>
        </Reasoning>
      )
    case 'tool_call':
      return <ToolRow item={item} />
    case 'approval':
      return <ApprovalCard item={item} threadId={threadId} />
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
  threadId,
}: {
  item: ThreadItem
  threadId: string
}) {
  return <ItemBody item={item} threadId={threadId} />
})
