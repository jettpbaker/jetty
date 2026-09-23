import type { Draft, QuestionProgress } from '@/state'
import type { QueuedMessage } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CheckSquareIcon,
  CircleIcon,
  RadioButtonIcon,
  SquareIcon,
} from '@phosphor-icons/react'
import { CheckIcon, ClockIcon, PencilIcon, XIcon } from '@primer/octicons-react'
import { useState, type ComponentProps, type ReactNode } from 'react'

import type { Approval, Question, Source, Todo } from './composer_strip_model'

import { NeedsInputIcon } from './circle_status_icon'
import { DisabledTooltip } from './disabled_tooltip'
import { InProgressIcon } from './in_progress_icon'
import { mediaUrl } from './media_layout'
import { ProviderGlyph } from './provider_glyph'

/* Small shared pieces */

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cn('min-w-0 truncate font-mono text-xs text-foreground', className)}>
      {children}
    </code>
  )
}

function SourceLabel({ source, className }: { source: Source; className?: string }) {
  if (source.kind === 'main') return null
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)}
    >
      <ProviderGlyph provider={source.provider} className='size-3 shrink-0' />
      <span className='shrink-0'>From subagent</span>
      <span className='truncate text-foreground/90'>{source.title}</span>
    </span>
  )
}

function Attention() {
  return <NeedsInputIcon aria-hidden='true' className='size-3.5 shrink-0 text-status-attention' />
}

function fieldValue(event: KeyboardEvent) {
  const target = event.target
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target.value
    : null
}

function firstLine(text: string) {
  return text.split('\n')[0]
}

function StripButton(props: ComponentProps<typeof Button>) {
  return <Button size='sm' {...props} className={cn('rounded-sm', props.className)} />
}

function FlushShell({ children }: { children: ReactNode }) {
  return (
    <div
      data-strip='banner'
      className='flex flex-col gap-2 rounded-t-md border border-b-0 border-border bg-(--strip-bg) px-3 py-2 text-sm'
    >
      {children}
    </div>
  )
}

function TrayShell({ children }: { children: ReactNode }) {
  return (
    <div
      data-strip='tray'
      className='flex flex-col gap-2 rounded-t-md border border-b-0 border-border bg-(--strip-bg) px-3 py-2.5 text-sm'
    >
      {children}
    </div>
  )
}

export function Pager({
  index,
  total,
  onPrev,
  onNext,
  nextDisabled,
  className,
}: {
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  nextDisabled?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('-my-1 flex shrink-0 items-center text-xs text-muted-foreground', className)}
    >
      <Button
        variant='ghost'
        tone='muted'
        size='icon'
        aria-label='Previous'
        disabled={index === 0}
        onClick={onPrev}
      >
        <CaretLeftIcon />
      </Button>
      <span className='min-w-6 text-center font-mono tabular-nums'>
        {index + 1}/{total}
      </span>
      <Button
        variant='ghost'
        tone='muted'
        size='icon'
        aria-label='Next'
        disabled={nextDisabled ?? index === total - 1}
        onClick={onNext}
      >
        <CaretRightIcon />
      </Button>
    </span>
  )
}

function StripToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <Button
      variant='ghost'
      tone='muted'
      size='icon'
      className='-my-1 -mr-1.5 shrink-0'
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      onClick={onToggle}
    >
      {open ? <CaretDownIcon /> : <CaretUpIcon />}
    </Button>
  )
}

/* 1a · Approval */

type Decision = 'once' | 'always' | 'deny'

export function useApproval(
  item: Approval | undefined,
  draft: string,
  setDraft: (value: string) => void,
  respond: (item: Approval, decision: Decision, note?: string) => void,
  // strip actions unmount their own button; this keeps a keyboard user in the composer
  keepFocus: () => void
) {
  const [confirmingId, setConfirmingId] = useState<string>()
  const [expandedId, setExpandedId] = useState<string>()
  const confirming = Boolean(item) && confirmingId === item?.id
  const expanded = Boolean(item) && expandedId === item?.id
  const canAlways = Boolean(item?.always)
  function decide(decision: Decision, note = '') {
    if (!item) return
    if (decision === 'always' && !canAlways) return
    keepFocus()
    if (decision === 'always' && !confirming) {
      setConfirmingId(item.id)
      return
    }
    respond(item, decision, note.trim())
  }
  function deny() {
    setDraft('')
    decide('deny', draft)
  }
  function send() {
    if (confirming) decide('always')
    else if (draft.trim()) deny()
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (confirming) setConfirmingId(undefined)
      else deny()
      return true
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      decide(event.shiftKey ? 'always' : 'once')
      return true
    }
    return false
  }
  return {
    confirming,
    expanded,
    canAlways,
    setConfirming(value: boolean) {
      keepFocus()
      setConfirmingId(value ? item?.id : undefined)
    },
    setExpanded(value: boolean) {
      keepFocus()
      setExpandedId(value ? item?.id : undefined)
    },
    decide,
    deny,
    send,
    onKey,
  }
}

type ApprovalControl = ReturnType<typeof useApproval>

function ApprovalActions({ ctl, typed }: { ctl: ApprovalControl; typed: boolean }) {
  if (ctl.confirming)
    return (
      <div className='flex shrink-0 items-center gap-1'>
        <StripButton variant='ghost' tone='muted' onClick={() => ctl.setConfirming(false)}>
          Cancel
        </StripButton>
        <StripButton onClick={() => ctl.decide('always')}>Allow always</StripButton>
      </div>
    )
  return (
    <div className='flex shrink-0 items-center gap-1'>
      <StripButton variant='ghost' tone='muted' onClick={ctl.deny}>
        {typed ? 'Deny with note' : 'Deny'}
      </StripButton>
      <DisabledTooltip
        reason={ctl.canAlways ? undefined : 'Not available for this request'}
        wrap='flex'
      >
        <StripButton
          variant='secondary'
          disabled={!ctl.canAlways}
          onClick={() => ctl.decide('always')}
          className={ctl.canAlways ? undefined : 'pointer-events-none'}
        >
          Allow always
        </StripButton>
      </DisabledTooltip>
      <StripButton onClick={() => ctl.decide('once')}>Allow once</StripButton>
    </div>
  )
}

function FullTarget({ item }: { item: Approval }) {
  return (
    <div className='flex flex-col gap-1 rounded-sm bg-background px-2.5 py-2 font-mono text-xs'>
      <span className='whitespace-pre-wrap wrap-anywhere'>
        {item.run && <span className='text-muted-foreground select-none'>$ </span>}
        {item.target}
      </span>
      {item.detail && (
        <span className='text-muted-foreground'>
          {item.run ? `in ${item.detail}` : item.detail}
        </span>
      )}
    </div>
  )
}

export function ApprovalStrip({
  item,
  ctl,
  typed,
  header,
  hideSource,
}: {
  item: Approval
  ctl: ApprovalControl
  typed: boolean
  header?: ReactNode
  hideSource?: boolean
}) {
  return (
    <FlushShell>
      {header}
      {!hideSource && <SourceLabel source={item.source} />}
      <div className='flex min-w-0 items-center gap-2'>
        <Attention />
        {ctl.confirming ? (
          <span className='flex min-w-0 flex-1 items-center gap-1.5'>
            <span className='shrink-0 text-muted-foreground'>Always allow</span>
            <Code>{item.always?.patterns.join(', ')}</Code>
            {item.always?.scope && (
              <span className='shrink-0 text-muted-foreground'>in {item.always.scope}?</span>
            )}
          </span>
        ) : (
          <span className='flex min-w-0 flex-1 items-center gap-1.5'>
            <span className='shrink-0 text-muted-foreground'>{item.action}</span>
            {!ctl.expanded && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- TooltipTrigger renders the target text inside it
                    <button
                      type='button'
                      aria-expanded={false}
                      onClick={() => ctl.setExpanded(true)}
                      className='flex min-w-0 rounded-xs hover:text-foreground'
                    />
                  }
                >
                  <Code className='hover:underline hover:decoration-muted-foreground hover:underline-offset-2'>
                    {item.target}
                  </Code>
                </TooltipTrigger>
                <TooltipContent>
                  Show the full {item.run ? 'command' : item.action === 'Edit' ? 'path' : 'input'}
                </TooltipContent>
              </Tooltip>
            )}
            {!ctl.expanded && item.action === 'Edit' && item.detail && (
              <span className='shrink-0 font-mono text-xs text-muted-foreground'>
                {item.detail}
              </span>
            )}
            {ctl.expanded && (
              <Button
                variant='ghost'
                tone='muted'
                size='icon'
                aria-label='Hide the full command'
                onClick={() => ctl.setExpanded(false)}
                className='-my-1'
              >
                <CaretUpIcon />
              </Button>
            )}
          </span>
        )}
        <ApprovalActions ctl={ctl} typed={typed} />
      </div>
      {ctl.expanded && !ctl.confirming && <FullTarget item={item} />}
    </FlushShell>
  )
}

/* 2a · Question */

function freshProgress(item: Question): QuestionProgress {
  return {
    step: 0,
    picks: item.questions.map(() => []),
    custom: item.questions.map(() => ''),
  }
}

// Progress lives in the draft store so it survives thread switches alongside the typed answer.
export function useQuestion(
  item: Question | undefined,
  saved: Draft,
  update: (patch: Partial<Draft>) => void,
  answer: (item: Question, answers: Record<string, string>) => void,
  dismiss: (item: Question) => void,
  keepFocus: () => void
) {
  const draft = saved.text
  const progress = item && (saved.questions?.[item.id] ?? freshProgress(item))
  const step = progress?.step ?? 0
  const spec = item?.questions[step]
  const total = item?.questions.length ?? 0
  const last = step === total - 1

  function save(next: QuestionProgress | undefined, text?: string) {
    if (!item) return
    const questions = { ...saved.questions }
    if (next) questions[item.id] = next
    else delete questions[item.id]
    update(text === undefined ? { questions } : { questions, text })
  }

  function answerAt(index: number) {
    if (!progress) return ''
    const typed = index === step ? draft : (progress.custom[index] ?? '')
    return typed.trim() || (progress.picks[index] ?? []).join(', ')
  }
  const current = answerAt(step)

  function pick(label: string) {
    if (!progress || !spec) return
    const picked = progress.picks[step] ?? []
    const next = spec.multiSelect
      ? picked.includes(label)
        ? picked.filter((entry) => entry !== label)
        : [...picked, label]
      : [label]
    save({ ...progress, picks: progress.picks.with(step, next) })
  }
  function go(to: number) {
    if (!progress || to < 0 || to >= total || to === step) return
    const custom = progress.custom.with(step, draft)
    save({ ...progress, step: to, custom }, custom[to] ?? '')
  }
  function next() {
    if (!item || !current) return
    if (!last) {
      go(step + 1)
      return
    }
    keepFocus()
    save(undefined, '')
    answer(
      item,
      Object.fromEntries(
        item.questions.map((question, index) => [question.question, answerAt(index)])
      )
    )
  }
  function onDismiss() {
    if (!item) return
    keepFocus()
    save(undefined, '')
    dismiss(item)
  }
  function onKey(event: KeyboardEvent) {
    if (event.defaultPrevented || !spec) return false
    if (event.key === 'Escape') {
      onDismiss()
      return true
    }
    if (
      /^[1-9]$/.test(event.key) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      fieldValue(event) === null
    ) {
      const option = spec.options[Number(event.key) - 1]
      if (!option) return false
      pick(option.label)
      return true
    }
    return false
  }
  return {
    step,
    spec,
    total,
    last,
    picks: progress?.picks[step] ?? [],
    answer: current,
    pick,
    go,
    next,
    dismiss: onDismiss,
    onKey,
  }
}

type QuestionControl = ReturnType<typeof useQuestion>

export function QuestionStrip({
  ctl,
  item,
  header,
  hideSource,
}: {
  ctl: QuestionControl
  item: Question
  header?: ReactNode
  hideSource?: boolean
}) {
  const spec = ctl.spec
  if (!spec) return null
  return (
    <FlushShell>
      {header}
      <div className='flex min-w-0 items-center gap-2'>
        <Attention />
        <span className='truncate text-xs font-medium text-muted-foreground'>
          {spec.header || 'Question'}
        </span>
        {!hideSource && <SourceLabel source={item.source} className='ml-1' />}
        <span
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1',
            ctl.total > 1 ? '-mr-1.5' : '-mr-2'
          )}
        >
          <StripButton variant='ghost-text' className='-my-1' onClick={ctl.dismiss}>
            Dismiss
          </StripButton>
          {ctl.total > 1 && (
            <Pager
              index={ctl.step}
              total={ctl.total}
              onPrev={() => ctl.go(ctl.step - 1)}
              onNext={ctl.next}
              nextDisabled={ctl.last || !ctl.answer}
            />
          )}
        </span>
      </div>
      <div className='scroll-fade-y scrollbar-subtle -mx-3 flex max-h-72 flex-col gap-2 overflow-y-auto px-3'>
        <p className='leading-relaxed whitespace-pre-line'>{spec.question}</p>
        {spec.options.length > 0 && (
          <div className='-mx-2 flex flex-col'>
            {spec.options.map((option) => {
              const selected = ctl.picks.includes(option.label)
              const Mark = spec.multiSelect
                ? selected
                  ? CheckSquareIcon
                  : SquareIcon
                : selected
                  ? RadioButtonIcon
                  : CircleIcon
              return (
                <button
                  key={option.label}
                  type='button'
                  role={spec.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  onClick={() => ctl.pick(option.label)}
                  className={cn(
                    'flex min-w-0 items-start gap-2 rounded-sm px-2 py-1 text-left hover:bg-accent',
                    selected && 'bg-accent'
                  )}
                >
                  <span className='flex h-5 shrink-0 items-center'>
                    <Mark
                      weight={selected ? 'fill' : 'bold'}
                      className={cn(
                        'size-3.5',
                        selected ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                  </span>
                  <span className='min-w-0 leading-5'>
                    {option.label}
                    {option.description && option.description !== option.label && (
                      <span className='ml-2 text-xs text-muted-foreground'>
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </FlushShell>
  )
}

/* 3a · Queued messages */

export type QueueControl = {
  queue: readonly QueuedMessage[]
  running: boolean
  editing?: string
  sendNow: (entry: QueuedMessage) => void
  edit: (entry: QueuedMessage) => void
  remove: (entry: QueuedMessage) => void
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant='ghost' tone='muted' size='icon' aria-label={label} onClick={onClick} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function SteerButton({ entry, q }: { entry: QueuedMessage; q: QueueControl }) {
  if (!q.running)
    return (
      <StripButton variant='ghost-text' onClick={() => q.sendNow(entry)}>
        Send
      </StripButton>
    )
  return (
    <Tooltip>
      <TooltipTrigger
        render={<StripButton variant='ghost-text' onClick={() => q.sendNow(entry)} />}
      >
        Steer
      </TooltipTrigger>
      <TooltipContent>Send into the running turn</TooltipContent>
    </Tooltip>
  )
}

function QueueActions({ entry, q }: { entry: QueuedMessage; q: QueueControl }) {
  return (
    <span className='flex shrink-0 items-center'>
      <SteerButton entry={entry} q={q} />
      <IconAction label='Edit' onClick={() => q.edit(entry)}>
        <PencilIcon />
      </IconAction>
      <IconAction label='Remove' onClick={() => q.remove(entry)}>
        <XIcon />
      </IconAction>
    </span>
  )
}

function QueuedImages({ entry }: { entry: QueuedMessage }) {
  const images = (entry.attachments ?? []).filter((attachment) =>
    attachment.mimeType.startsWith('image/')
  )
  if (images.length === 0) return null
  return (
    <span className='flex shrink-0 gap-1'>
      {images.map((image) => (
        <img
          key={image.id}
          src={mediaUrl(image)}
          alt={image.name}
          decoding='async'
          draggable={false}
          className='size-5 rounded-xs object-cover'
        />
      ))}
    </span>
  )
}

function QueueRow({ entry, q }: { entry: QueuedMessage; q: QueueControl }) {
  if (entry.id === q.editing)
    return (
      <div className='flex h-7 min-w-0 items-center gap-2 text-muted-foreground'>
        <QueuedImages entry={entry} />
        <span className='min-w-0 flex-1 truncate'>{firstLine(entry.text)}</span>
        <span className='shrink-0 text-xs'>Editing</span>
      </div>
    )
  return (
    <div className='group/row flex h-7 min-w-0 items-center gap-2'>
      <QueuedImages entry={entry} />
      <span className='min-w-0 flex-1 truncate'>{firstLine(entry.text)}</span>
      <span className='-mr-1.5 flex opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100'>
        <QueueActions entry={entry} q={q} />
      </span>
    </div>
  )
}

export function QueueTray({ q }: { q: QueueControl }) {
  const [open, setOpen] = useState(true)
  const [head] = q.queue
  if (!head) return null
  if (q.queue.length === 1)
    return (
      <TrayShell>
        <div className='flex min-w-0 items-center gap-2'>
          <ClockIcon className='size-3.5 shrink-0 text-muted-foreground' />
          <div className='min-w-0 flex-1'>
            <QueueRow entry={head} q={q} />
          </div>
        </div>
      </TrayShell>
    )
  const next = q.queue.find((entry) => entry.id !== q.editing) ?? head
  return (
    <TrayShell>
      <div className='flex min-w-0 items-center gap-2'>
        <ClockIcon className='size-3.5 shrink-0 text-muted-foreground' />
        <span className='shrink-0 text-xs text-muted-foreground'>{q.queue.length} queued</span>
        {open ? (
          <span className='flex-1' />
        ) : (
          <span className='min-w-0 flex-1 truncate'>{firstLine(next.text)}</span>
        )}
        <StripToggle
          open={open}
          onToggle={() => setOpen((value) => !value)}
          label='queued messages'
        />
      </div>
      {open && (
        <div className='flex flex-col'>
          {q.queue.map((entry) => (
            <QueueRow key={entry.id} entry={entry} q={q} />
          ))}
        </div>
      )}
    </TrayShell>
  )
}

/* 4a · Todo progress */

function TodoIcon({ status }: { status: Todo['status'] }) {
  if (status === 'done') return <CheckIcon className='size-3.5 shrink-0 text-muted-foreground' />
  if (status === 'active')
    return <InProgressIcon aria-hidden='true' className='size-3.5 shrink-0 text-status-working' />
  return <CircleIcon className='size-3.5 shrink-0 text-muted-foreground' />
}

export function TodoList({ list }: { list: readonly Todo[] }) {
  return (
    <ol className='flex flex-col gap-1.5'>
      {list.map((todo) => (
        <li key={todo.id} className='flex min-w-0 items-center gap-2'>
          <TodoIcon status={todo.status} />
          <span
            className={cn(
              'truncate',
              todo.status === 'done' && 'text-muted-foreground line-through',
              todo.status === 'pending' && 'text-muted-foreground'
            )}
          >
            {todo.text}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function TodoLine({ list, current }: { list: readonly Todo[]; current: Todo }) {
  const [open, setOpen] = useState(false)
  const done = list.filter((todo) => todo.status === 'done').length
  return (
    <FlushShell>
      <div className='flex min-w-0 items-start gap-2'>
        {open ? (
          <div className='min-w-0 flex-1 py-0.5'>
            <TodoList list={list} />
          </div>
        ) : (
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <InProgressIcon aria-hidden='true' className='size-3.5 shrink-0 text-status-working' />
            <span className='shrink-0 font-mono text-xs text-muted-foreground tabular-nums'>
              {done}/{list.length}
            </span>
            <span className='min-w-0 flex-1 truncate'>{current.text}</span>
          </div>
        )}
        <StripToggle open={open} onToggle={() => setOpen((value) => !value)} label='tasks' />
      </div>
    </FlushShell>
  )
}

/* 5a · Several pending at once */

export function SeveralHeader({
  index,
  total,
  source,
  queued,
  onChoose,
}: {
  index: number
  total: number
  source: Source
  queued: number
  onChoose: (index: number) => void
}) {
  return (
    <div className='flex min-w-0 items-center gap-2 pt-1 text-xs text-muted-foreground'>
      <Pager
        className='-ml-1.5'
        index={index}
        total={total}
        onPrev={() => onChoose(index - 1)}
        onNext={() => onChoose(index + 1)}
      />
      <SourceLabel source={source} />
      <span className='ml-auto'>
        {queued > 0 && (
          <span className='flex shrink-0 items-center gap-1'>
            <ClockIcon className='size-3' />
            {queued} queued
          </span>
        )}
      </span>
    </div>
  )
}
