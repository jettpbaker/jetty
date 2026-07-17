import type { ThreadItem } from '@jetty/shared/items'

import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Response } from '@/components/response'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Message, MessageContent } from '@/components/ui/message'
import { memo } from 'react'

type ToolState = 'input-available' | 'output-available' | 'output-error'

function toolState(status: 'running' | 'succeeded' | 'failed'): ToolState {
  switch (status) {
    case 'running':
      return 'input-available'
    case 'succeeded':
      return 'output-available'
    case 'failed':
      return 'output-error'
  }
}

function ItemBody({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case 'user_message':
      return (
        <Message align='end'>
          <MessageContent>
            <Bubble variant='secondary' align='end'>
              <BubbleContent>{item.text}</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )
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
      return (
        <Tool>
          <ToolHeader
            title={item.toolName}
            type={`tool-${item.toolName}`}
            state={toolState(item.status)}
          />
          <ToolContent>
            <ToolInput input={item.input} />
            <ToolOutput
              output={item.status === 'failed' ? undefined : item.output}
              errorText={item.status === 'failed' ? item.output : undefined}
            />
          </ToolContent>
        </Tool>
      )
    case 'approval':
      return (
        <Card>
          <CardHeader>
            <CardTitle>{item.title}</CardTitle>
            <Badge variant={item.decision === 'deny' ? 'destructive' : 'secondary'}>
              {item.decision ?? 'pending'}
            </Badge>
          </CardHeader>
          <CardContent className='text-muted-foreground text-sm'>{item.toolName}</CardContent>
        </Card>
      )
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

export const TimelineItem = memo(function TimelineItem({ item }: { item: ThreadItem }) {
  return <ItemBody item={item} />
})
