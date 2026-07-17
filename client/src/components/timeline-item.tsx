import type { ThreadItem } from '@jetty/shared/items'

import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
        <Message from='user'>
          <MessageContent>{item.text}</MessageContent>
        </Message>
      )
    case 'assistant_message':
      return (
        <Message from='assistant'>
          <MessageContent>
            <MessageResponse>{item.text}</MessageResponse>
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
          <MessageResponse>{item.text}</MessageResponse>
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
