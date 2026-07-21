import type { ThreadItem } from '@jetty/shared/items'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pressHandlers } from '@/lib/press-handlers'
import { cn } from '@/lib/utils'
import { CheckIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type QuestionItem = Extract<ThreadItem, { kind: 'question' }>

// Wizard over 1–4 questions: single-select picks advance (and submit on the
// last), multi-select toggles behind an explicit Next/Submit. "Other" is
// host-provided — the model is told never to include its own.
export function QuestionDock({
  item,
  respond,
}: {
  item: QuestionItem
  respond: (answers: Record<string, string>) => Promise<unknown>
}) {
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const [pending, setPending] = useState(false)
  const otherRef = useRef<HTMLInputElement>(null)

  const q = item.questions[index]!
  const last = index === item.questions.length - 1
  const picks = selected[q.question] ?? []

  function submit(answers: Record<string, string[]>) {
    setPending(true)
    respond(
      Object.fromEntries(
        item.questions
          .map((question) => [question.question, (answers[question.question] ?? []).join(', ')])
          .filter(([, answer]) => answer !== '')
      )
    ).catch(() => {
      setPending(false)
      toast.error('Couldn’t send your answer.')
    })
  }

  function advance(answers: Record<string, string[]>) {
    setOtherOpen(false)
    setOtherText('')
    if (last) submit(answers)
    else setIndex(index + 1)
  }

  function pick(label: string) {
    if (q.multiSelect) {
      const next = picks.includes(label) ? picks.filter((p) => p !== label) : [...picks, label]
      setSelected({ ...selected, [q.question]: next })
      return
    }
    const answers = { ...selected, [q.question]: [label] }
    setSelected(answers)
    advance(answers)
  }

  function commitOther() {
    const text = otherText.trim()
    if (!text) return
    const answers = { ...selected, [q.question]: q.multiSelect ? [...picks, text] : [text] }
    setSelected(answers)
    advance(answers)
  }

  useEffect(() => {
    if (otherOpen) otherRef.current?.focus()
  }, [otherOpen])

  // number keys jump-select; skip when typing in the Other input
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (pending || otherOpen) return
      const n = Number(event.key)
      if (n >= 1 && n <= q.options.length) {
        event.preventDefault()
        pick(q.options[n - 1]!.label)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className='flex flex-col gap-3 rounded-lg border border-border bg-card/70 p-3 backdrop-blur-lg'>
      <div className='flex items-baseline justify-between gap-2'>
        <span className='text-sm text-foreground'>{q.question}</span>
        {item.questions.length > 1 ? (
          <span className='shrink-0 text-muted-foreground text-xs'>
            {index + 1} / {item.questions.length}
          </span>
        ) : null}
      </div>

      <div className='flex flex-col gap-1.5'>
        {q.options.map((option) => {
          const isPicked = picks.includes(option.label)
          return (
            <button
              key={option.label}
              type='button'
              disabled={pending}
              className={cn(
                'flex w-full items-baseline gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                isPicked && 'border-ring bg-muted'
              )}
              {...pressHandlers(() => pick(option.label))}
            >
              {q.multiSelect ? (
                <CheckIcon
                  className={cn('size-3.5 shrink-0 self-center', !isPicked && 'invisible')}
                />
              ) : null}
              <span className='shrink-0'>{option.label}</span>
              <span className='min-w-0 text-muted-foreground'>{option.description}</span>
            </button>
          )
        })}

        {otherOpen ? (
          <div className='flex items-center gap-2'>
            <Input
              ref={otherRef}
              disabled={pending}
              value={otherText}
              onChange={(event) => setOtherText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitOther()
                else if (event.key === 'Escape') setOtherOpen(false)
              }}
              placeholder='Type your own answer'
            />
            <Button size='sm' disabled={pending || !otherText.trim()} onClick={commitOther}>
              {q.multiSelect || !last ? 'Next' : 'Answer'}
            </Button>
          </div>
        ) : (
          <button
            type='button'
            disabled={pending}
            className='w-full rounded-md border border-border border-dashed px-3 py-2 text-left text-muted-foreground text-sm transition-colors hover:bg-muted'
            {...pressHandlers(() => setOtherOpen(true))}
          >
            Type your own answer…
          </button>
        )}
      </div>

      <div className='flex items-center gap-2'>
        {index > 0 ? (
          <Button
            variant='ghost'
            size='sm'
            disabled={pending}
            {...pressHandlers(() => setIndex(index - 1))}
          >
            Back
          </Button>
        ) : null}
        {q.multiSelect ? (
          <Button
            size='sm'
            className='ml-auto'
            disabled={pending || picks.length === 0}
            {...pressHandlers(() => advance(selected))}
          >
            {last ? 'Answer' : 'Next'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
