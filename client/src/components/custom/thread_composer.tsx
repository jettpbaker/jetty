import type { Draft, DraftTarget } from '@/state'
import type { ThreadItem } from '@jetty/shared/items'
import type { QueuedMessage } from '@jetty/shared/wire'

import { Composer } from '@/components/custom/composer'
import { ComposerFooter } from '@/components/custom/composer_footer'
import { ComposerLoadout } from '@/components/custom/composer_loadout'
import {
  ApprovalStrip,
  PendingHeader,
  QuestionStrip,
  QueueTray,
  TodoLine,
  useApproval,
  useQuestion,
} from '@/components/custom/composer_strip'
import { currentTodos, pendingItems } from '@/components/custom/composer_strip_model'
import { WorkflowLines } from '@/components/custom/workflow_lines'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useImageAttachments } from '@/hooks/use-image-attachments'
import { findModel } from '@/lib/loadout'
import { pressProps } from '@/lib/press'
import { newThreadProject } from '@/lib/thread_project'
import {
  useAccessMode,
  useChrome,
  useCreateThread,
  useDismissQuestion,
  useDraft,
  useInterruptTurn,
  useLoadouts,
  useQueueActions,
  useRespondApproval,
  useRespondQuestion,
  useSendTurn,
  useThreadLoadout,
  useThreadQueue,
} from '@/state'
import { useProjectGit, useRetrySetup } from '@/state/worktrees'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { MonitoringLine } from './monitoring_line'

const noItems: readonly ThreadItem[] = []

// How long a request must be on screen before text started in the composer answers it.
const noticeMs = 1000

export function ThreadComposer({
  threadId,
  items = noItems,
  running,
  rows,
  ambient = false,
  loading = false,
  provider = 'claude',
  projectPath,
  projectTitle,
}: {
  threadId?: string
  items?: readonly ThreadItem[]
  running: boolean
  rows: number
  ambient?: boolean
  // Sending waits for the thread: it matches the prompt against the thread's earlier messages.
  loading?: boolean
  provider?: string
  projectPath?: string
  projectTitle?: string
}) {
  const draftKey = threadId ?? ''
  const { draft: saved, update, read } = useDraft(draftKey)
  const draft = saved.text
  const editing = saved.editing
  const attachments = useImageAttachments(draftKey)
  const { loadouts, catalog, setLoadouts } = useLoadouts()
  const { loadout, lockedProvider, setLoadout } = useThreadLoadout(threadId)
  const { accessMode, setAccessMode } = useAccessMode()
  const sendTurn = useSendTurn()
  const interruptTurn = useInterruptTurn()
  const createThread = useCreateThread()
  const respondApproval = useRespondApproval()
  const respondQuestion = useRespondQuestion()
  const dismissQuestion = useDismissQuestion()
  const queueActions = useQueueActions()
  const queued = useThreadQueue(threadId)
  const queue = useMemo(() => queued.filter((entry) => !entry.from), [queued])
  const navigate = useNavigate()
  const chrome = useChrome()
  const selectedId = useParams({ strict: false }).threadId
  const [queueOpen, setQueueOpen] = useState(false)
  const target = saved.target
  const picked = chrome?.projects.some((project) => project.id === target?.projectId)
  const projectId =
    !threadId && chrome
      ? picked
        ? target?.projectId
        : newThreadProject(chrome, selectedId)
      : undefined
  const git = useProjectGit(projectId)?.git
  const environment =
    git === 'missing' || git === 'not-git' ? 'local' : (target?.environment ?? 'worktree')
  const startingRef = target?.ref
  function retarget(patch: DraftTarget) {
    update({ target: { ...read().target, ...patch } })
  }
  const meta = chrome?.threads.find((thread) => thread.id === threadId)
  const retrySetup = useRetrySetup()
  const needsModel = !threadId && !loadout

  const pending = useMemo(
    () => pendingItems(items, { provider, projectPath, projectTitle }),
    [items, projectPath, projectTitle, provider]
  )
  const index = Math.max(
    0,
    pending.findIndex((entry) => entry.id === saved.pendingId)
  )
  const item = pending[index]
  const shown = useRef<{ id?: string; at: number }>({ at: 0 })
  useEffect(() => {
    if (shown.current.id !== item?.id) shown.current = { id: item?.id, at: performance.now() }
  }, [item?.id])

  // Text keeps the intent it was started with: a request that shows up mid-message, or just
  // before it, leaves Enter queueing or sending it rather than answering the request.
  const typed = draft.trim() !== ''
  const answering = Boolean(item) && (!typed || saved.typedFor === item?.id)
  function setDraft(text: string) {
    if (typed || !text.trim()) return update({ text })
    const noticed = item && performance.now() - shown.current.at >= noticeMs
    update({ text, typedFor: noticed ? item.id : undefined })
  }
  const stripDraft = answering ? saved : { ...saved, text: '' }
  function stripUpdate({ text, ...patch }: Partial<Draft>) {
    update(answering && text !== undefined ? { ...patch, text } : patch)
  }

  // The next item to show brings back whatever was typed for it earlier.
  function settled(entry: { id: string }) {
    const next = pending.find((candidate) => candidate.id !== entry.id)
    const parked = next && saved.parked?.[next.id]
    if (!next || parked === undefined || !answering) return
    const { [next.id]: _, ...rest } = saved.parked ?? {}
    update({ pendingId: next.id, text: parked, typedFor: next.id, parked: rest })
  }

  const approval = useApproval(
    item?.kind === 'approval' ? item : undefined,
    stripDraft.text,
    setDraft,
    (entry, decision, note) => {
      if (!threadId) return
      respondApproval(threadId, entry.id, decision === 'once' ? 'allow' : decision, note)
      settled(entry)
    },
    keepKeyboardFocus
  )
  const question = useQuestion(
    item?.kind === 'question' ? item : undefined,
    stripDraft,
    stripUpdate,
    (entry, answers) => {
      if (!threadId) return
      respondQuestion(threadId, entry.id, answers)
      settled(entry)
    },
    (entry) => {
      if (!threadId) return
      dismissQuestion(threadId, entry.id)
      settled(entry)
    },
    keepKeyboardFocus
  )
  const todos = useMemo(() => currentTodos(items), [items])
  const openTodo =
    todos.find((entry) => entry.status === 'active') ??
    todos.find((entry) => entry.status === 'pending')
  // Stays while tasks are open, even once the turn ends.
  const todo = openTodo ?? (running ? todos.at(-1) : undefined)
  const editingEntry = queue.find((entry) => entry.id === editing)
  const input = useRef<HTMLTextAreaElement>(null)
  const focusEdit = useRef(false)

  // The Edit button unmounts as its row turns into "Editing"; the loaded draft takes focus.
  useLayoutEffect(() => {
    const element = input.current
    if (!focusEdit.current || !element) return
    focusEdit.current = false
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
  }, [editing])

  // Steer, Remove and strip answers unmount their button; a keyboard user would otherwise be
  // dropped on the page.
  function keepKeyboardFocus() {
    if (document.activeElement?.matches(':focus-visible'))
      input.current?.focus({ preventScroll: true })
  }

  function priorCount(text: string) {
    return items.filter((entry) => entry.kind === 'user_message' && entry.text === text).length
  }

  // In the background, the new-thread page stays put with its picks for the next prompt.
  function startTurn(text: string, background: boolean) {
    const id =
      threadId ?? (projectId ? createThread(projectId, environment, startingRef) : undefined)
    if (!id) return
    const prior = priorCount(text)
    const kept = read().target
    setDraft('')
    const open = () => void navigate({ to: '/threads/$threadId', params: { threadId: id } })
    // Shown at once for instant feedback, and withdrawn if the send fails so Open never dangles.
    const notice =
      background && !threadId
        ? toast('Started in background', { action: { label: 'Open', onClick: open } })
        : undefined
    sendTurn(id, text, prior, loadout, attachments.take(), draftKey, () => {
      if (notice !== undefined) toast.dismiss(notice)
    })
    if (threadId) return
    if (!background) return open()
    update({ target: kept })
  }

  function submit(background = false) {
    const text = draft.trim()
    if (!text && attachments.images.length === 0) return
    if (threadId && text && editingEntry) queueActions.edit(threadId, editingEntry.id, text)
    else if (threadId && running) queueActions.add(threadId, text, attachments.take())
    else return startTurn(text, background)
    clearDraft()
  }

  // A reply set aside to edit a queued message comes back once the edit is done.
  function clearDraft() {
    const reply = item && saved.parked?.[item.id]
    if (!item || reply === undefined) return update({ text: '', editing: undefined })
    const { [item.id]: _, ...parked } = saved.parked ?? {}
    update({ text: reply, editing: undefined, typedFor: item.id, parked })
  }

  const paused = Boolean(chrome?.threads.find((thread) => thread.id === threadId)?.queuePaused)
  const queueControl = {
    queue,
    waiting: paused ? queued.length - queue.length : 0,
    running,
    paused,
    editing,
    sendNow(entry: QueuedMessage) {
      if (!threadId) return
      keepKeyboardFocus()
      queueActions.sendNow(threadId, entry.id)
    },
    edit(entry: QueuedMessage) {
      if (!threadId) return
      const previous = draft.trim()
      const reply = answering && previous ? item : undefined
      if (previous && editingEntry) queueActions.edit(threadId, editingEntry.id, previous)
      else if (editingEntry) queueActions.release(threadId, editingEntry.id)
      else if (previous && !reply) queueActions.add(threadId, previous, attachments.take())
      queueActions.hold(threadId, entry.id)
      focusEdit.current = true
      update({
        text: entry.text,
        editing: entry.id,
        typedFor: undefined,
        ...(reply && { parked: { ...saved.parked, [reply.id]: draft } }),
      })
    },
    remove(entry: QueuedMessage) {
      if (!threadId) return
      keepKeyboardFocus()
      queueActions.remove(threadId, entry.id)
    },
  }

  // Each pending item keeps its own typed text, so paging never answers one with another's.
  function choose(to: number) {
    const target = pending[to]
    if (!target || !item || target === item) return
    shown.current = { id: target.id, at: 0 }
    if (!answering) return update({ pendingId: target.id })
    const parked = Object.fromEntries(
      Object.entries(saved.parked ?? {}).filter(([id]) =>
        pending.some((entry) => entry.id === id && entry !== target)
      )
    )
    update({
      pendingId: target.id,
      text: saved.parked?.[target.id] ?? '',
      typedFor: target.id,
      parked: { ...parked, [item.id]: draft },
    })
  }

  const header = item && (pending.length > 1 || queue.length > 0 || queueControl.waiting > 0) && (
    <PendingHeader
      index={index}
      total={pending.length}
      source={item.source}
      q={queueControl}
      open={queueOpen}
      onToggle={() => setQueueOpen((open) => !open)}
      onChoose={choose}
    />
  )

  function keyHandler(handle: (event: KeyboardEvent) => boolean) {
    return (event: KeyboardEvent) => {
      if (!event.defaultPrevented && handle(event)) event.preventDefault()
    }
  }

  const answer =
    item?.kind === 'approval'
      ? {
          strip: (
            <ApprovalStrip
              item={item}
              ctl={approval}
              typed={typed && answering}
              header={header}
              hideSource={Boolean(header)}
            />
          ),
          placeholder: 'Tell the agent what to do instead',
          sendLabel: approval.confirming ? 'Allow always' : 'Deny with note',
          sendDisabled: !typed && !approval.confirming,
          onSubmit: approval.send,
          onKeyDown: keyHandler(approval.onKey),
        }
      : item?.kind === 'question' && question.spec
        ? {
            strip: (
              <QuestionStrip
                ctl={question}
                item={item}
                header={header}
                hideSource={Boolean(header)}
              />
            ),
            placeholder: question.spec.options.length
              ? 'Or type your own answer'
              : 'Type your answer',
            sendLabel: question.last ? 'Submit' : 'Next',
            sendDisabled: !question.answer,
            onSubmit: question.next,
            onKeyDown: keyHandler(question.onKey),
          }
        : undefined
  const mode =
    answer && answering
      ? answer
      : {
          strip:
            answer?.strip ??
            (queue.length > 0 || queueControl.waiting > 0 ? (
              <QueueTray q={queueControl} />
            ) : todo ? (
              <TodoLine list={todos} current={todo} />
            ) : undefined),
          placeholder: !threadId
            ? undefined
            : running
              ? 'Queue a follow-up while the agent works'
              : 'Ask for follow-up changes',
          sendLabel: running ? (item ? 'Queue as a follow-up' : 'Queue') : 'Send',
          sendDisabled: (!threadId && !projectId) || needsModel || loading ? true : undefined,
          onSubmit: () => submit(),
          onKeyDown: keyHandler((event) => {
            if (event.key !== 'Escape' || !editing) return false
            if (threadId) queueActions.release(threadId, editing)
            clearDraft()
            return true
          }),
        }

  return (
    <div className='mx-auto w-full max-w-[708px] px-6 pb-1'>
      {meta?.worktree?.state === 'setting_up' && (
        <output className='block pb-2 text-xs text-muted-foreground'>Setting up worktree…</output>
      )}
      {meta?.worktree?.state === 'failed' && (
        <div role='alert' className='flex items-center gap-2 pb-2 text-xs text-destructive'>
          <span>{meta.worktree.error}</span>
          <Button
            variant='outline'
            size='sm'
            {...pressProps(() => threadId && retrySetup(threadId))}
          >
            Retry
          </Button>
        </div>
      )}
      <Composer
        value={draft}
        onValueChange={setDraft}
        onSubmit={mode.onSubmit}
        onBackgroundSubmit={threadId ? undefined : () => submit(true)}
        onInterrupt={() => {
          if (threadId) interruptTurn(threadId)
        }}
        running={running && !item}
        strip={mode.strip}
        placeholder={mode.placeholder}
        sendLabel={mode.sendLabel}
        sendDisabled={mode.sendDisabled}
        sendHint={
          needsModel ? (
            'Choose a model first'
          ) : threadId ? undefined : (
            <span className='flex flex-col gap-1'>
              <span className='flex items-center justify-between gap-3'>
                Send <Kbd>↵</Kbd>
              </span>
              <span className='flex items-center justify-between gap-3'>
                Send in background <Kbd>⌘↵</Kbd>
              </span>
            </span>
          )
        }
        onKeyDown={mode.onKeyDown}
        loadout={
          <ComposerLoadout
            catalog={catalog}
            loadouts={loadouts}
            value={loadout}
            lockedProvider={lockedProvider}
            onChange={setLoadout}
            onReorder={setLoadouts}
            onOpenSettings={() => void navigate({ to: '/settings' })}
          />
        }
        model={loadout && findModel(catalog, loadout)}
        accessMode={accessMode}
        onAccessModeChange={setAccessMode}
        attachments={attachments}
        context={
          threadId ? (
            // Holds the project/branch footer's height so the composer sits where it did on the new thread.
            <div className='flex w-full flex-col'>
              {meta?.backgroundTasks?.length ? (
                <MonitoringLine key={threadId} threadId={threadId} tasks={meta.backgroundTasks} />
              ) : null}
              <div className='flex min-h-7 items-center justify-between px-2.5'>
                <WorkflowLines threadId={threadId} items={items} />
                <span className='ml-auto text-xs text-muted-foreground'>
                  {meta?.environment === 'worktree' ? 'Worktree · ' : ''}
                  {meta?.worktree?.branch ?? meta?.git?.branch}
                </span>
              </div>
            </div>
          ) : (
            <ComposerFooter
              projectId={projectId}
              onProjectChange={(id) => {
                if (id !== projectId) retarget({ projectId: id, ref: undefined })
              }}
              environment={environment}
              onEnvironmentChange={(next) => retarget({ environment: next })}
              startingRef={startingRef}
              onStartingRefChange={(ref) => retarget({ ref })}
            />
          )
        }
        rows={rows}
        ambient={ambient}
        inputRef={input}
        slash={{ threadId, projectId: projectId ?? meta?.projectId }}
      />
    </div>
  )
}
