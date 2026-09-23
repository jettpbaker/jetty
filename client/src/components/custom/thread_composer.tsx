import type { Draft } from '@/state'
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
import { ContainerSetupDialog } from '@/components/custom/container_setup_dialog'
import { WorkflowLines } from '@/components/custom/workflow_lines'
import { useImageAttachments } from '@/hooks/use-image-attachments'
import { findModel } from '@/lib/loadout'
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
import { useContainerStatus } from '@/state/containers'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const noItems: readonly ThreadItem[] = []

// How long a request must be on screen before text started in the composer answers it.
const noticeMs = 1000

export function ThreadComposer({
  threadId,
  items = noItems,
  running,
  rows,
  ambient = false,
  provider = 'claude',
  projectPath,
  projectTitle,
}: {
  threadId?: string
  items?: readonly ThreadItem[]
  running: boolean
  rows: number
  ambient?: boolean
  provider?: string
  projectPath?: string
  projectTitle?: string
}) {
  const draftKey = threadId ?? ''
  const { draft: saved, update } = useDraft(draftKey)
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
  const queue = useThreadQueue(threadId)
  const navigate = useNavigate()
  const chrome = useChrome()
  const selectedId = useParams({ strict: false }).threadId
  const [pickedProjectId, setPickedProjectId] = useState<string>()
  const [queueOpen, setQueueOpen] = useState(false)
  const [environment, setEnvironment] = useState<'local' | 'container'>('local')
  const [startingRef, setStartingRef] = useState('HEAD')
  const [setupOpen, setSetupOpen] = useState(false)
  const { status: containerStatus } = useContainerStatus()
  const projectId =
    !threadId && chrome ? (pickedProjectId ?? newThreadProject(chrome, selectedId)) : undefined
  const currentProject = chrome?.projects.find(
    (project) =>
      project.id ===
      (projectId ?? chrome.threads.find((thread) => thread.id === threadId)?.projectId)
  )
  const threadEnvironment = chrome?.threads.find((thread) => thread.id === threadId)?.environment
  const selectedEnvironment = threadEnvironment ?? environment
  const containerAvailable = Boolean(
    containerStatus?.enabled &&
    currentProject?.containerReady &&
    loadout &&
    currentProject.containerProviders?.[loadout.provider]
  )
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

  function startTurn(text: string) {
    const id =
      threadId ?? (projectId ? createThread(projectId, environment, startingRef) : undefined)
    if (!id) return
    const prior = priorCount(text)
    setDraft('')
    sendTurn(id, text, prior, loadout, attachments.take(), draftKey)
    if (!threadId) void navigate({ to: '/threads/$threadId', params: { threadId: id } })
  }

  function submit() {
    const text = draft.trim()
    if (!text && attachments.images.length === 0) return
    if (threadId && text && editingEntry) queueActions.edit(threadId, editingEntry.id, text)
    else if (threadId && running) queueActions.add(threadId, text, attachments.take())
    else return startTurn(text)
    clearDraft()
  }

  // A reply set aside to edit a queued message comes back once the edit is done.
  function clearDraft() {
    const reply = item && saved.parked?.[item.id]
    if (!item || reply === undefined) return update({ text: '', editing: undefined })
    const { [item.id]: _, ...parked } = saved.parked ?? {}
    update({ text: reply, editing: undefined, typedFor: item.id, parked })
  }

  const queueControl = {
    queue,
    running,
    paused: Boolean(chrome?.threads.find((thread) => thread.id === threadId)?.queuePaused),
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

  const header = item && (pending.length > 1 || queue.length > 0) && (
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
            (queue.length > 0 ? (
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
          sendDisabled: (!threadId && !projectId) || needsModel ? true : undefined,
          onSubmit: submit,
          onKeyDown: keyHandler((event) => {
            if (event.key !== 'Escape' || !editing) return false
            if (threadId) queueActions.release(threadId, editing)
            clearDraft()
            return true
          }),
        }

  return (
    <div className='mx-auto w-full max-w-[708px] px-6 pb-1'>
      <Composer
        environment={selectedEnvironment}
        containersConfigured={containerAvailable}
        onEnvironmentChange={threadId ? undefined : setEnvironment}
        onSetupContainers={containerStatus?.enabled ? () => setSetupOpen(true) : undefined}
        startingRef={startingRef}
        onStartingRefChange={threadId ? undefined : setStartingRef}
        value={draft}
        onValueChange={setDraft}
        onSubmit={mode.onSubmit}
        onInterrupt={() => {
          if (threadId) interruptTurn(threadId)
        }}
        running={running && !item}
        strip={mode.strip}
        placeholder={mode.placeholder}
        sendLabel={mode.sendLabel}
        sendDisabled={
          mode.sendDisabled || (selectedEnvironment === 'container' && !containerAvailable)
        }
        sendHint={
          needsModel
            ? 'Choose a model first'
            : selectedEnvironment === 'container' && !containerAvailable
              ? 'Set up this provider for containers'
              : undefined
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
            <WorkflowLines threadId={threadId} items={items} />
          ) : (
            <ComposerFooter projectId={projectId} onProjectChange={setPickedProjectId} />
          )
        }
        rows={rows}
        ambient={ambient}
        inputRef={input}
      />
      <ContainerSetupDialog
        project={currentProject}
        open={setupOpen}
        onOpenChange={setSetupOpen}
        enabled={Boolean(containerStatus?.enabled && containerStatus.docker)}
      />
    </div>
  )
}
