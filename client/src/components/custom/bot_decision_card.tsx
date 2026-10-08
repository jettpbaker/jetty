import type { QuestionSpec, ThreadItem } from '@jetty/shared/items'
import type { Bot } from '@jetty/shared/wire'

import { botAccentClass } from '@/components/custom/bot_avatar'
import { approvalView } from '@/components/custom/composer_strip_model'
import { Tick02Icon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import {
  useDismissQuestion,
  useDraft,
  useRespondApproval,
  useRespondQuestion,
  type QuestionProgress,
} from '@/state'
import { Fragment } from 'react'

export type BotDecision = Extract<ThreadItem, { kind: 'approval' | 'question' }>
const cardClass =
  'flex w-full max-w-[515px] flex-col gap-3 self-start rounded-[18.5px] bg-muted px-4 pt-2 pb-3'
const toolVerbs: Record<string, string> = {
  WebFetch: 'Fetch',
  WebSearch: 'Search',
  Read: 'Read',
  Glob: 'Find',
  Grep: 'Search',
}

export function BotDecisionCard({ item, bot }: { item: BotDecision; bot: Bot }) {
  return item.kind === 'approval' ? (
    <BotApprovalCard item={item} bot={bot} />
  ) : (
    <BotQuestionCard item={item} bot={bot} />
  )
}

function BotApprovalCard({
  item,
  bot,
}: {
  item: Extract<BotDecision, { kind: 'approval' }>
  bot: Bot
}) {
  const respond = useRespondApproval()
  const view = approvalView(item, undefined)
  const command = view.target || item.toolName
  if (item.decision || item.withdrawn || item.completedAt)
    return (
      <div className={cn(cardClass, 'py-2 text-muted-foreground')}>
        <div className='flex min-w-0 items-center gap-2 text-sm'>
          <Tick02Icon className='size-3.5 shrink-0' />
          <span className='shrink-0'>
            {item.decision === 'always'
              ? 'Allowed always'
              : item.decision === 'allow'
                ? 'Allowed once'
                : item.decision === 'deny'
                  ? 'Denied'
                  : 'Withdrawn'}
          </span>
          <span className='truncate font-mono text-xs' title={command}>
            {command}
          </span>
        </div>
      </div>
    )
  return (
    <div className={cardClass}>
      <div className='flex flex-col gap-0.5'>
        <div className='text-sm leading-[22.75px]'>{item.title.replace(/[.!?…]*$/, '?')}</div>
        <div className='flex min-w-0 items-baseline gap-1.5 text-sm'>
          <span className='shrink-0 text-muted-foreground'>
            {view.run ? 'Run' : (toolVerbs[item.toolName] ?? view.action)}
          </span>
          <span className='min-w-0 font-mono text-xs wrap-anywhere'>
            <SlashBreaks text={command} />
          </span>
        </div>
      </div>
      <div className='flex items-center justify-between gap-2'>
        <Button
          size='sm'
          variant='ghost-text'
          tone='muted'
          className='-ml-2.25'
          onClick={() => respond(bot.id, item.id, 'deny')}
        >
          Deny
        </Button>
        <div className={cn('flex shrink-0 items-center gap-1', botAccentClass)}>
          <Button
            size='sm'
            variant='secondary'
            // Secondary is the card's own muted fill; Allow always takes the accent step above it.
            className='[--secondary:var(--accent)]'
            onClick={() => respond(bot.id, item.id, 'always')}
          >
            Allow always
          </Button>
          <Button size='sm' onClick={() => respond(bot.id, item.id, 'allow')}>
            Allow once
          </Button>
        </div>
      </div>
    </div>
  )
}

function BotQuestionCard({
  item,
  bot,
}: {
  item: Extract<BotDecision, { kind: 'question' }>
  bot: Bot
}) {
  const { draft, update } = useDraft(bot.id)
  const respond = useRespondQuestion()
  const dismiss = useDismissQuestion()
  const progress: QuestionProgress = draft.questions?.[item.id] ?? {
    step: 0,
    picks: item.questions.map(() => []),
    custom: item.questions.map(() => ''),
  }
  const spec = item.questions[progress.step]
  const answered = Boolean(item.answers || item.dismissed || item.completedAt)
  function save(next: QuestionProgress) {
    update({ questions: { ...draft.questions, [item.id]: next } })
  }
  function submit(next: QuestionProgress) {
    if (next.step < item.questions.length - 1) {
      save({ ...next, step: next.step + 1 })
      return
    }
    respond(
      bot.id,
      item.id,
      Object.fromEntries(
        item.questions.map((question, index) => [
          question.question,
          [...(next.picks[index] ?? []), next.custom[index]?.trim()].filter(Boolean).join(', '),
        ])
      ),
      next,
      true
    )
  }
  function pick(label: string) {
    if (!spec) return
    const selected = progress.picks[progress.step] ?? []
    const picks = spec.multiSelect
      ? selected.includes(label)
        ? selected.filter((pick) => pick !== label)
        : [...selected, label]
      : [label]
    if (spec.multiSelect) save({ ...progress, picks: progress.picks.with(progress.step, picks) })
    else
      submit({
        ...progress,
        picks: progress.picks.with(progress.step, picks),
        custom: progress.custom.with(progress.step, ''),
      })
  }
  if (answered)
    return (
      <div className={cn(cardClass, 'text-muted-foreground')}>
        {item.questions.map((question) => {
          const answer = item.answers?.[question.question]
          return (
            <div key={question.question} className='flex flex-col gap-3'>
              <div className='text-sm leading-[22.75px]'>{question.question}</div>
              <div className='overflow-hidden rounded-md border border-border bg-background'>
                {(answer
                  ? answerRows(question, answer)
                  : [{ label: item.dismissed ? 'Dismissed' : 'Withdrawn', description: '' }]
                ).map((option) => (
                  <div
                    key={option.label}
                    className='flex items-start gap-2 border-t border-border px-[11px] py-2 first:border-t-0'
                  >
                    <span className='flex h-5 w-4 shrink-0 items-center'>
                      <Tick02Icon className='size-3.5' />
                    </span>
                    <div className='flex min-w-0 flex-wrap items-baseline gap-x-2'>
                      <span className='text-sm'>{option.label}</span>
                      <span className='text-xs'>{option.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  if (!spec) return null
  const current = progress.custom[progress.step] ?? ''
  const ready = Boolean(current.trim() || progress.picks[progress.step]?.length)
  return (
    <div className={cardClass}>
      <div className='flex items-baseline gap-2'>
        <div className='min-w-0 grow text-sm leading-[22.75px]'>{spec.question}</div>
        <Button
          variant='ghost-text'
          tone='muted'
          size='sm'
          className='-mr-2.25'
          onClick={() => dismiss(bot.id, item.id, progress, true)}
        >
          Dismiss
        </Button>
      </div>
      <div className='flex flex-col gap-3'>
        <div className='flex flex-col overflow-hidden rounded-md border border-border bg-background'>
          {spec.options.map((option, index) => (
            <button
              key={option.label}
              type='button'
              aria-pressed={
                spec.multiSelect ? progress.picks[progress.step]?.includes(option.label) : undefined
              }
              className='flex items-start gap-2 border-t border-border px-[11px] py-2 text-left outline-none first:border-t-0 hover:bg-accent focus-visible:bg-accent'
              onClick={() => pick(option.label)}
            >
              <span className='flex h-5 w-4 shrink-0 items-center justify-center'>
                {progress.picks[progress.step]?.includes(option.label) ? (
                  <Tick02Icon className='size-3.5' />
                ) : (
                  <span className='rounded-sm border border-border px-0.5 font-mono text-xs text-muted-foreground'>
                    {String.fromCharCode(65 + index)}
                  </span>
                )}
              </span>
              <div className='flex min-w-0 flex-wrap items-baseline gap-x-2'>
                <span className='text-sm'>{option.label}</span>
                <span className='text-xs text-muted-foreground'>{option.description}</span>
              </div>
            </button>
          ))}
        </div>
        <Input
          aria-label='Other answer'
          placeholder='Other…'
          value={current}
          onChange={(event) =>
            save({ ...progress, custom: progress.custom.with(progress.step, event.target.value) })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && ready && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit(progress)
            }
          }}
          className='border-0 bg-background px-3 shadow-none dark:bg-background'
        />
        {(spec.multiSelect || current.trim()) && (
          <div className={cn('flex justify-end', botAccentClass)}>
            <Button size='sm' disabled={!ready} onClick={() => submit(progress)}>
              {progress.step < item.questions.length - 1 ? 'Next' : 'Send'}
              <Kbd>↵</Kbd>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// Multi-select answers are the ticked labels, then any Other text, joined by ", ".
function answerRows(question: QuestionSpec, answer: string) {
  const parts = question.multiSelect ? answer.split(', ') : [answer]
  const options = question.options.filter((option) => parts.includes(option.label))
  const other = parts.filter((part) => !options.some((option) => option.label === part)).join(', ')
  return other ? [...options, { label: other, description: '' }] : options
}

// Chrome won't break a path at its slashes on its own.
function SlashBreaks({ text }: { text: string }) {
  return text.split(/(?<=\/)/).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ))
}
