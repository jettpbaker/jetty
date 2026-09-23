import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'

export function ErrorMessage({ message }: { message: string }) {
  return (
    <Message align='start'>
      <MessageContent>
        <Bubble variant='destructive' align='start'>
          <BubbleContent>{message}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
