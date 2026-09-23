import type { ThreadItem } from '@jetty/shared/items'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import { useState } from 'react'

type QuestionItem = Extract<ThreadItem, { kind: 'question' }>

export function QuestionMessage({
  item,
  onAnswer,
}: {
  item: QuestionItem
  onAnswer?: (answers: Record<string, string>) => void
}) {
  const [picks, setPicks] = useState<Readonly<Record<string, readonly string[]>>>({})
  const only = item.questions.length === 1 ? item.questions[0] : undefined
  const interactive = Boolean(onAnswer) && !item.answers && !item.skipped
  const singleClick = Boolean(interactive && only && !only.multiSelect)

  function choose(question: string, label: string, multi: boolean) {
    if (!onAnswer) return
    if (!multi && item.questions.length === 1) {
      onAnswer({ [question]: label })
      return
    }
    setPicks((current) => {
      const selected = current[question] ?? []
      const next = multi
        ? selected.includes(label)
          ? selected.filter((entry) => entry !== label)
          : [...selected, label]
        : [label]
      return { ...current, [question]: next }
    })
  }

  function submit() {
    if (!onAnswer) return
    const answers: Record<string, string> = {}
    for (const spec of item.questions) {
      const selected = picks[spec.question] ?? []
      if (selected.length === 0) return
      answers[spec.question] = selected.join(',')
    }
    onAnswer(answers)
  }

  const ready =
    item.questions.length > 0 &&
    item.questions.every((spec) => (picks[spec.question]?.length ?? 0) > 0)

  return (
    <Message align='start'>
      <MessageContent>
        <Bubble variant='outline' align='start'>
          <BubbleContent className='flex flex-col gap-3'>
            {item.questions.map((spec) => {
              const answer = item.answers?.[spec.question]
              const selected = picks[spec.question] ?? []
              return (
                <div key={spec.question} className='flex flex-col gap-1'>
                  {spec.header ? (
                    <p className='text-xs text-muted-foreground'>{spec.header}</p>
                  ) : null}
                  <p>{spec.question}</p>
                  {spec.options.length > 0 &&
                    (interactive ? (
                      <div className='flex flex-wrap gap-2'>
                        {spec.options.map((option) => (
                          <Button
                            key={option.label}
                            size='xs'
                            variant={selected.includes(option.label) ? 'default' : 'outline'}
                            aria-pressed={
                              spec.multiSelect ? selected.includes(option.label) : undefined
                            }
                            onClick={() => choose(spec.question, option.label, spec.multiSelect)}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <ul className='list-disc pl-4 text-muted-foreground'>
                        {spec.options.map((option) => (
                          <li key={option.label}>
                            {option.label}
                            {option.description ? ` — ${option.description}` : ''}
                          </li>
                        ))}
                      </ul>
                    ))}
                  {answer ? <p className='text-xs'>Answer: {answer}</p> : null}
                </div>
              )
            })}
            {interactive && !singleClick ? (
              <Button size='xs' disabled={!ready} onClick={submit}>
                Submit
              </Button>
            ) : null}
            {item.skipped ? (
              <p className='text-xs text-muted-foreground'>Skipped</p>
            ) : item.answers || interactive ? null : (
              <p className='text-xs text-muted-foreground'>Waiting for an answer</p>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
