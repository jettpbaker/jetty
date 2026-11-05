import type { Draft, QuestionProgress } from '@/state'
import type { Todo } from '@jetty/shared/todos'

import {
  ChevronDownSmallIcon,
  ChevronLeftSmallIcon,
  ChevronRightSmallIcon,
  ChevronTopSmallIcon,
  CirclePlaceholderOnIcon,
  Checkmark1MediumIcon,
  Progress50Icon,
  QuestionmarkCircleIcon,
} from '@/components/custom/central_icons'
import { Loading } from '@/components/custom/loading'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { preloadable } from '@/lib/preload'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'

import type { Approval, Question, Secret, Source } from './composer_strip_model'

import { DiffCounts } from './diff/file_card'
import { loadDiffWorkerPool } from './diff_worker_pool'
import { DisabledTooltip } from './disabled_tooltip'
import { KeybindChip, keybinds } from './keybinds'
import { SourceLabel } from './source_label'

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cn('min-w-0 truncate font-mono text-xs text-foreground', className)}>
      {children}
    </code>
  )
}

function RequestSource({ source, className }: { source: Source; className?: string }) {
  if (source.kind === 'main') return null
  return (
    <SourceLabel provider={source.provider} className={className}>
      <span className='shrink-0'>From subagent</span>
      <span className='truncate text-foreground/90'>{source.title}</span>
    </SourceLabel>
  )
}

function Attention() {
  return (
    <QuestionmarkCircleIcon
      filled
      aria-hidden='true'
      className='size-4 shrink-0 text-status-attention'
    />
  )
}

function fieldValue(event: KeyboardEvent) {
  const target = event.target
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target.value
    : null
}

function StripButton(props: ComponentProps<typeof Button>) {
  return <Button size='sm' {...props} className={cn('rounded-sm', props.className)} />
}

function FlushShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-strip='banner'
      className={cn(
        'flex flex-col gap-2 bg-popover px-3 py-2 text-sm first:rounded-t-md',
        className
      )}
    >
      {children}
    </div>
  )
}

// Agent text: links are the only markup it gets.
function withLinks(text: string) {
  return text.split(/(https:\/\/[^\s)]*[^\s).,;:!?])/).map((part, index) =>
    index % 2 ? (
      <a
        key={part}
        href={part}
        target='_blank'
        rel='noreferrer'
        className='text-primary hover:underline'
      >
        {part}
      </a>
    ) : (
      part
    )
  )
}

export function SecretStrip({
  item,
  respond,
  composerHasText,
  header,
  hideSource,
}: {
  item: Secret
  respond: (secret: string | null) => void
  composerHasText: boolean
  header?: ReactNode
  hideSource?: boolean
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const [hasValue, setHasValue] = useState(false)
  const shouldFocusRef = useRef(!composerHasText)
  useEffect(() => {
    const field = fieldRef.current
    if (shouldFocusRef.current) field?.focus({ preventScroll: true })
    return () => {
      if (field) field.value = ''
    }
  }, [])
  function save() {
    const value = fieldRef.current?.value
    if (value?.trim()) respond(value)
  }
  return (
    <FlushShell className='p-3'>
      {header}
      {!hideSource && <RequestSource source={item.source} />}
      <div className='flex min-w-0 items-start gap-2'>
        <span className='flex h-5 shrink-0 items-center'>
          <Attention />
        </span>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <p className='text-sm leading-5 font-medium'>{item.label}</p>
          <p className='text-xs leading-4 whitespace-pre-line text-muted-foreground wrap-anywhere'>
            {withLinks(item.reason)}
          </p>
        </div>
        <Button
          variant='ghost-text'
          size='xs'
          className='-mt-1 -mr-2'
          onClick={() => respond(null)}
        >
          Decline
        </Button>
      </div>
      <div className='flex min-w-0 items-center gap-2'>
        <textarea
          ref={fieldRef}
          rows={1}
          aria-label={item.label}
          className='field-sizing-content max-h-40 min-h-7 min-w-0 flex-1 resize-none rounded-sm bg-foreground/8 px-2.5 py-1 font-mono text-sm leading-5 outline-none [-webkit-text-security:disc] placeholder:font-sans'
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          data-1p-ignore
          data-lpignore='true'
          data-bwignore
          placeholder='Paste the secret'
          onChange={(event) => setHasValue(Boolean(event.currentTarget.value.trim()))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            save()
          }}
        />
        <StripButton disabled={!hasValue} onClick={save}>
          Save
        </StripButton>
      </div>
    </FlushShell>
  )
}

export function Pager({
  index,
  total,
  noun,
  onPrev,
  onNext,
  nextDisabled,
  inScroller,
  compact = false,
  className,
}: {
  index: number
  total: number
  noun: string
  onPrev: () => void
  onNext: () => void
  nextDisabled?: boolean
  inScroller?: boolean
  compact?: boolean
  className?: string
}) {
  const activate = (action: () => void) => (inScroller ? { onClick: action } : pressProps(action))
  return (
    <span
      className={cn(
        'flex shrink-0 items-center text-xs text-muted-foreground',
        compact ? 'gap-0.5' : '-my-1',
        className
      )}
    >
      <Button
        variant='ghost'
        size={compact ? 'icon-xs' : 'icon'}
        aria-label={`Previous ${noun}`}
        disabled={index === 0}
        {...activate(onPrev)}
      >
        <ChevronLeftSmallIcon />
      </Button>
      <span className={cn('text-center font-mono tabular-nums', !compact && 'min-w-6')}>
        {index + 1}/{total}
      </span>
      <Button
        variant='ghost'
        size={compact ? 'icon-xs' : 'icon'}
        aria-label={`Next ${noun}`}
        disabled={nextDisabled ?? index === total - 1}
        {...activate(onNext)}
      >
        <ChevronRightSmallIcon />
      </Button>
    </span>
  )
}

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
  const [menuId, setMenuId] = useState<string>()
  const [expandedId, setExpandedId] = useState<string>()
  const confirming = Boolean(item) && confirmingId === item?.id
  const expanded = Boolean(item) && expandedId === item?.id
  const menuOpen = Boolean(item) && menuId === item?.id
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
    if (draft) setDraft('')
    decide('deny', draft)
  }
  function send() {
    if (confirming) decide('always')
    else if (draft.trim()) deny()
  }
  function onKey(event: KeyboardEvent) {
    if (menuOpen) return false
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
    menuOpen,
    setMenuOpen(value: boolean) {
      setMenuId(value ? item?.id : undefined)
    },
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

function ApprovalActions({
  ctl,
  typed,
  run,
}: {
  ctl: ApprovalControl
  typed: boolean
  run: boolean
}) {
  if (ctl.confirming)
    return (
      <div className='flex shrink-0 items-center gap-2'>
        <StripButton variant='ghost-text' onClick={() => ctl.setConfirming(false)}>
          Cancel
        </StripButton>
        <StripButton onClick={() => ctl.decide('always')}>Allow always</StripButton>
      </div>
    )
  return (
    <div className='flex shrink-0 items-center gap-2'>
      <StripButton variant='outline' onClick={ctl.deny} aria-keyshortcuts='Escape'>
        {typed ? 'Deny with note' : 'Deny'}
        <KeybindChip binding={keybinds.denyApproval} />
      </StripButton>
      <div className='flex'>
        <StripButton
          variant='default'
          className='rounded-r-none'
          onClick={() => ctl.decide('once')}
          aria-keyshortcuts='Meta+Enter Control+Enter'
        >
          Allow once
          <KeybindChip binding={keybinds.allowOnce} />
        </StripButton>
        <DropdownMenu open={ctl.menuOpen} onOpenChange={ctl.setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                variant='default'
                size='icon-sm'
                className='rounded-sm rounded-l-none border-l border-primary-foreground/20'
                aria-label='More approval options'
              />
            }
          >
            <ChevronDownSmallIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuGroup>
              <DisabledTooltip
                reason={
                  ctl.canAlways
                    ? undefined
                    : `The agent didn't offer a rule for this ${run ? 'command' : 'action'}`
                }
                side='left'
              >
                <DropdownMenuItem disabled={!ctl.canAlways} onClick={() => ctl.decide('always')}>
                  Always allow this {run ? 'command' : 'action'}
                </DropdownMenuItem>
              </DisabledTooltip>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

const proposedDiff = preloadable(() =>
  Promise.all([import('./proposed_diff'), loadDiffWorkerPool()]).then(([module]) => module)
)

function ProposedDiff(props: ComponentProps<typeof import('./proposed_diff').ProposedDiff>) {
  const loaded = proposedDiff.useLoaded()
  return <loaded.ProposedDiff {...props} />
}

function FullTarget({ item }: { item: Approval }) {
  const className =
    'scrollbar-subtle flex max-h-28 flex-col gap-1 overflow-y-auto rounded-sm bg-background px-2.5 py-2 font-mono text-xs leading-5'
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a long command scrolls; keyboard users need access to the entire request
    <pre tabIndex={0} className={className}>
      <span className='whitespace-pre-wrap wrap-anywhere'>
        {item.run && <span className='text-muted-foreground select-none'>$ </span>}
        {item.target}
      </span>
      {item.detail && (
        <span className='whitespace-pre-wrap text-muted-foreground wrap-anywhere'>
          {item.run ? `in ${item.detail}` : item.detail}
        </span>
      )}
      {item.counts && <DiffCounts files={[item.counts]} />}
    </pre>
  )
}

export function ApprovalStrip({
  item,
  ctl,
  typed,
  followUp,
  header,
  hideSource,
}: {
  item: Approval
  ctl: ApprovalControl
  typed: boolean
  followUp?: boolean
  header?: ReactNode
  hideSource?: boolean
}) {
  const changesId = useId()
  const { changes } = item
  const binaryProposal =
    changes !== undefined && changes.files.length > 0 && changes.files.every((file) => file.binary)
  // The diff loads and highlights while the request is read, so it expands coloured.
  const patch = changes?.patch
  useEffect(() => {
    if (patch !== undefined)
      void proposedDiff
        .preload()
        .then(({ primeProposedDiff }) => primeProposedDiff(patch))
        .catch(() => {})
  }, [patch])
  return (
    <FlushShell>
      {header}
      {!hideSource && <RequestSource source={item.source} />}
      <div className='flex min-w-0 items-center gap-2'>
        <Attention />
        {ctl.confirming ? (
          <span className='flex min-w-0 flex-1 items-center gap-1.5'>
            <span className='shrink-0 text-muted-foreground'>Always allow</span>
            <Code className='whitespace-pre-wrap wrap-anywhere text-clip'>
              {item.always?.patterns.join(', ')}
            </Code>
            {item.always?.scope && (
              <span className='shrink-0 text-muted-foreground'>in {item.always.scope}?</span>
            )}
          </span>
        ) : (
          <span className='flex min-w-0 flex-1 items-center gap-1.5'>
            <span className='shrink-0 font-medium text-foreground'>
              {item.run ? 'Run this command?' : item.action}
            </span>
            {!ctl.expanded && !item.run && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- TooltipTrigger renders the target text inside it
                    <button
                      type='button'
                      aria-expanded={false}
                      {...pressProps(() => ctl.setExpanded(true))}
                      className='flex min-w-0 rounded-xs hover:text-foreground'
                    />
                  }
                >
                  <Code
                    className={cn(
                      'hover:underline hover:decoration-muted-foreground hover:underline-offset-2',
                      changes && changes.files.length > 1 && 'font-sans text-sm'
                    )}
                  >
                    {item.target}
                  </Code>
                </TooltipTrigger>
                <TooltipContent>
                  {changes
                    ? 'Show the changes'
                    : `Show the full ${item.run ? 'command' : item.action === 'Edit' ? 'path' : 'input'}`}
                </TooltipContent>
              </Tooltip>
            )}
            {!ctl.expanded &&
              !item.run &&
              (binaryProposal ? (
                <span className='shrink-0 text-xs text-muted-foreground'>Binary</span>
              ) : (
                item.counts && <DiffCounts files={[item.counts]} />
              ))}
            {ctl.expanded && !item.run && (
              <Button
                variant='ghost'
                size='icon'
                aria-label={changes ? 'Hide the changes' : 'Hide the full command'}
                aria-expanded
                aria-controls={changes ? changesId : undefined}
                {...pressProps(() => ctl.setExpanded(false))}
                className='-my-1'
              >
                <ChevronTopSmallIcon />
              </Button>
            )}
          </span>
        )}
        <ApprovalActions ctl={ctl} typed={typed} run={item.run} />
      </div>
      {item.run && <FullTarget item={item} />}
      {ctl.expanded &&
        !item.run &&
        !ctl.confirming &&
        (changes ? (
          <Suspense fallback={<Loading />}>
            <ProposedDiff id={changesId} changes={changes} />
          </Suspense>
        ) : (
          <FullTarget item={item} />
        ))}
      {followUp && <FollowUpNote />}
    </FlushShell>
  )
}

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
  // each gets the progress it clears, to bring back if the server doesn't take it
  answer: (item: Question, answers: Record<string, string>, progress: QuestionProgress) => void,
  dismiss: (item: Question, progress: QuestionProgress) => void,
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

  function answerAt(state: QuestionProgress, index: number) {
    const typed = (state.custom[index] ?? '').trim()
    const picks = state.picks[index] ?? []
    return item?.questions[index]?.multiSelect
      ? [...picks, typed].filter(Boolean).join(', ')
      : typed || picks.join(', ')
  }
  const current = progress
    ? answerAt({ ...progress, custom: progress.custom.with(step, draft) }, step)
    : ''

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
  // Moves past this question, or once it's the last, sends what was answered. Skipped questions
  // are left out of the answers; skipping them all dismisses the set.
  function advance(state: QuestionProgress) {
    if (!item) return
    const open = item.questions.findIndex(
      (_, index) => !answerAt(state, index) && !state.skipped?.[index]
    )
    const to = last ? open : step + 1
    if (to !== -1) {
      save({ ...state, step: to }, state.custom[to] ?? '')
      return
    }
    keepFocus()
    save(undefined, '')
    const answers = Object.fromEntries(
      item.questions.flatMap((question, index) => {
        const value = answerAt(state, index)
        return value ? [[question.question, value]] : []
      })
    )
    if (Object.keys(answers).length > 0) answer(item, answers, state)
    else dismiss(item, state)
  }
  function next() {
    if (!progress || !current) return
    advance({ ...progress, custom: progress.custom.with(step, draft) })
  }
  function skip() {
    if (!item || !progress) return
    advance({
      ...progress,
      picks: progress.picks.with(step, []),
      custom: progress.custom.with(step, ''),
      skipped: (progress.skipped ?? item.questions.map(() => false)).with(step, true),
    })
  }
  function onDismiss() {
    if (!item || !progress) return
    keepFocus()
    save(undefined, '')
    dismiss(item, { ...progress, custom: progress.custom.with(step, draft) })
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
    skip,
    dismiss: onDismiss,
    onKey,
  }
}

type QuestionControl = ReturnType<typeof useQuestion>

function FollowUpNote() {
  return <p className='text-xs text-muted-foreground'>Enter queues this as a follow-up</p>
}

export function QuestionStrip({
  ctl,
  item,
  followUp,
  header,
  hideSource,
}: {
  ctl: QuestionControl
  item: Question
  followUp?: boolean
  header?: ReactNode
  hideSource?: boolean
}) {
  const spec = ctl.spec
  if (!spec) return null
  return (
    <FlushShell className='gap-1 p-3'>
      {header}
      {!hideSource && <RequestSource source={item.source} />}
      <div
        className={cn('flex min-w-0 gap-3 pb-1', spec.multiSelect ? 'items-start' : 'items-center')}
      >
        <span className='flex h-5 shrink-0 items-center'>
          <Attention />
        </span>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <p className='text-sm leading-5 font-medium whitespace-pre-line'>{spec.question}</p>
          {spec.multiSelect && (
            <p className='text-xs leading-4 text-muted-foreground'>Select all that apply</p>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {ctl.total > 1 && (
            <Pager
              compact
              noun='question'
              index={ctl.step}
              total={ctl.total}
              onPrev={() => ctl.go(ctl.step - 1)}
              onNext={() => ctl.go(ctl.step + 1)}
            />
          )}
          <Button variant='ghost-text' size='xs' onClick={ctl.skip}>
            Skip question
          </Button>
          {ctl.total > 1 && (
            <Button variant='ghost-text' size='xs' onClick={ctl.dismiss}>
              Skip all questions
            </Button>
          )}
        </div>
      </div>
      {spec.options.length > 0 && <QuestionOptions ctl={ctl} />}
      <div className='flex items-center justify-end gap-2 pt-2'>
        <Button size='sm' disabled={!ctl.answer} onClick={ctl.next}>
          {ctl.last ? 'Answer' : 'Next'}
          <Kbd>↵</Kbd>
        </Button>
      </div>
      {followUp && <FollowUpNote />}
    </FlushShell>
  )
}

function QuestionOptions({ ctl }: { ctl: QuestionControl }) {
  const spec = ctl.spec!
  const options = spec.options.map((option, index) => {
    const selected = ctl.picks.includes(option.label)
    const className = cn(
      'flex min-w-0 items-center gap-3 rounded-menu-item px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
      selected && 'bg-accent'
    )
    const content = (
      <>
        <span
          aria-hidden='true'
          className={cn(
            'flex size-4 shrink-0 items-center justify-center border border-muted-foreground',
            spec.multiSelect ? 'rounded-xs' : 'rounded-full',
            selected && 'border-primary text-primary'
          )}
        >
          {selected && <Checkmark1MediumIcon className='size-3' />}
        </span>
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='text-sm leading-5'>{option.label}</span>
          {option.description && option.description !== option.label && (
            <span className='text-xs leading-4 text-muted-foreground'>{option.description}</span>
          )}
        </span>
        {index < 9 && <Kbd>{index + 1}</Kbd>}
      </>
    )
    return spec.multiSelect ? (
      <button
        key={option.label}
        type='button'
        role='checkbox'
        aria-checked={selected}
        onClick={() => ctl.pick(option.label)}
        className={className}
      >
        {content}
      </button>
    ) : (
      <Radio.Root
        key={option.label}
        value={option.label}
        nativeButton
        render={<button type='button' />}
        className={className}
      >
        {content}
      </Radio.Root>
    )
  })
  const className = 'scroll-fade-y scrollbar-subtle flex max-h-72 flex-col gap-1 overflow-y-auto'
  return spec.multiSelect ? (
    <div className={className} role='group' aria-label={spec.question}>
      {options}
    </div>
  ) : (
    <RadioGroup
      key={ctl.step}
      className={className}
      aria-label={spec.question}
      value={ctl.picks[0] ?? null}
      onValueChange={(value) => {
        if (value) ctl.pick(value)
      }}
    >
      {options}
    </RadioGroup>
  )
}

function TodoIcon({ status }: { status: Todo['status'] }) {
  if (status === 'done')
    return <Checkmark1MediumIcon className='size-3.5 shrink-0 text-muted-foreground' />
  if (status === 'active')
    return <Progress50Icon aria-hidden='true' className='size-3.5 shrink-0 text-status-working' />
  return <CirclePlaceholderOnIcon className='size-3.5 shrink-0 text-muted-foreground' />
}

export function TodoList({ list }: { list: readonly Todo[] }) {
  return (
    <ol className='flex flex-col gap-1.5'>
      {list.map((todo) => (
        <li key={todo.id} className='flex min-w-0 items-center gap-2'>
          <TodoIcon status={todo.status} />
          <span
            className={cn(
              'min-w-0 text-13 leading-5 whitespace-normal wrap-anywhere',
              todo.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'
            )}
          >
            {todo.text}
          </span>
        </li>
      ))}
    </ol>
  )
}

// Pages between pending requests, beside whose the shown one is.
export function PendingHeader({
  index,
  total,
  source,
  onChoose,
}: {
  index: number
  total: number
  source: Source
  onChoose: (index: number) => void
}) {
  return (
    <div className='flex min-w-0 items-center gap-2 pt-1 text-xs text-muted-foreground'>
      <Pager
        noun='request'
        className='-ml-1.5'
        index={index}
        total={total}
        onPrev={() => onChoose(index - 1)}
        onNext={() => onChoose(index + 1)}
      />
      <RequestSource source={source} />
    </div>
  )
}
