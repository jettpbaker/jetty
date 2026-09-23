import type { ThreadItem } from '@jetty/shared/items'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'

type QuestionItem = Extract<ThreadItem, { kind: 'question' }>

export function QuestionMessage({ item }: { item: QuestionItem }) {
  return (
    <Message align='start'>
      <MessageContent>
        <Bubble variant='outline' align='start'>
          <BubbleContent className='flex flex-col gap-3'>
            {item.questions.map((spec) => {
              const answer = item.answers?.[spec.question]
              return (
                <div key={spec.question} className='flex flex-col gap-1'>
                  {spec.header ? (
                    <p className='text-xs text-muted-foreground'>{spec.header}</p>
                  ) : null}
                  <p>{spec.question}</p>
                  {spec.options.length > 0 && (
                    <ul className='list-disc pl-4 text-muted-foreground'>
                      {spec.options.map((option) => (
                        <li key={option.label}>
                          {option.label}
                          {option.description ? ` — ${option.description}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  {answer ? <p className='text-xs'>Answer: {answer}</p> : null}
                </div>
              )
            })}
            {item.skipped ? (
              <p className='text-xs text-muted-foreground'>Skipped</p>
            ) : item.answers ? null : (
              <p className='text-xs text-muted-foreground'>Waiting for an answer</p>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
