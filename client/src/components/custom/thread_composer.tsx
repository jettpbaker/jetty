import type { Draft, DraftTarget } from '@/state'
import type { ThreadItem } from '@jetty/shared/items'
import type { QueuedMessage } from '@jetty/shared/wire'

import { Composer } from '@/components/custom/composer'
import { ComposerFooter } from '@/components/custom/composer_footer'
import { ComposerLoadout } from '@/components/custom/composer_loadout'
import { ComposerProject } from '@/components/custom/composer_project'
import {
  ApprovalStrip,
  PendingHeader,
  QuestionStrip,
  useApproval,
  useQuestion,
} from '@/components/custom/composer_strip'
import { pendingItems } from '@/components/custom/composer_strip_model'
import { UsageBanner } from '@/components/custom/usage_limits'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useImageAttachments } from '@/hooks/use-image-attachments'
import { useNow } from '@/hooks/use-now'
import { findModel } from '@/lib/loadout'
import { pressProps } from '@/lib/press'
import { newThreadProject } from '@/lib/thread_project'
import { threadBranch } from '@/lib/thread_worktree'
import {
  useAccessMode,
  useChrome,
  useContinueThread,
  useCreateThread,
  useDismissQuestion,
  useDraft,
  useInterruptTurn,
  useLoadouts,
  useQueueActions,
  useQueueComposer,
  useRespondApproval,
  useRespondQuestion,
  useSendTurn,
  useThreadLoadout,
  useVisibleQueue,
} from '@/state'
import { usageFreshMs, useProviderUsage, type UsageProvider } from '@/state/provider-usage'
import { useProjectGit, useRetrySetup } from '@/state/worktrees'
import { heldByRestarts } from '@jetty/shared/items'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { MonitoringLine } from './monitoring_line'
import { ThreadFooter } from './thread_footer'

const noItems: readonly ThreadItem[] = []

// How long a request must be on screen before text started in the composer answers it.
const noticeMs = 1000

// The project a new-thread draft pinned itself to when it was started, rather than one picked.
let draftPin: string | undefined

// /usage's tray reads usage itself: the composer would otherwise re-render on every usage read
// (pointing at Usage, opening it or Settings), each provider's separately.
function ComposerUsage({
  provider,
  asked,
  onOpen,
  onDismiss,
}: {
  provider: UsageProvider
  asked: number
  onOpen: () => void
  onDismiss: () => void
}) {
  const { reads, failed, refresh } = useProviderUsage()
  useEffect(() => refresh([provider], usageFreshMs), [provider, asked, refresh])
  const read = reads[provider]
  const now = Math.max(useNow(60_000), read?.at ?? 0)
  return (
    <UsageBanner
      provider={provider}
      usage={read?.usage}
      failed={failed.has(provider)}
      now={now}
      onOpen={onOpen}
      onDismiss={onDismiss}
    />
  )
}

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
  // Sending waits for the thread: until it loads, whether a send starts a turn or queues is unknown.
  loading?: boolean
  provider?: string
  projectPath?: string
  projectTitle?: string
}) {
  const draftKey = threadId ?? ''
  const { draft: saved, update, read } = useDraft(draftKey)
  const draft = saved.text
  const editing = saved.editing
  // The queue shows in the chat; here it's only the message being edited.
  const { own: queue, unsent } = useVisibleQueue(threadId, items)
  const editingEntry = queue.find((entry) => entry.id === editing)
  const attachments = useImageAttachments(draftKey, editingEntry !== undefined)
  const { loadouts, catalog, setLoadouts } = useLoadouts()
  const { loadout, lockedProvider, setLoadout } = useThreadLoadout(threadId)
  const { accessMode, setAccessMode } = useAccessMode()
  const sendTurn = useSendTurn()
  const interruptTurn = useInterruptTurn()
  const continueThread = useContinueThread()
  const createThread = useCreateThread()
  const respondApproval = useRespondApproval()
  const respondQuestion = useRespondQuestion()
  const dismissQuestion = useDismissQuestion()
  const queueActions = useQueueActions()
  const navigate = useNavigate()
  const chrome = useChrome()
  const selectedId = useParams({ strict: false }).threadId
  const target = saved.target
  const picked = chrome?.projects.some((project) => project.id === target?.projectId)
  const projectId =
    !threadId && chrome
      ? picked
        ? target?.projectId
        : newThreadProject(chrome, selectedId)
      : undefined
  const projectGit = useProjectGit(projectId)
  const noGit = projectGit?.git === 'missing' || projectGit?.git === 'not-git'
  const projectDefault = projectGit?.git === 'ok' ? projectGit.defaultEnvironment : undefined
  const setupGuide = projectGit?.git === 'ok' ? projectGit.setupGuide : undefined
  const environment = noGit ? 'local' : (target?.environment ?? projectDefault ?? 'worktree')
  const startingRef = target?.ref
  function retarget(patch: DraftTarget) {
    update({ target: { ...read().target, ...patch } })
  }
  // A started draft keeps the project it was started in, though a thread elsewhere may become the
  // most recent while it's written. Emptied and left, it lets go, so coming back follows the most
  // recent thread again; a picked project stays.
  const started = draft.trim() !== '' || attachments.images.length > 0
  useEffect(() => {
    if (threadId || !started || !projectId || picked) return
    draftPin = projectId
    update({ target: { ...read().target, projectId } })
  }, [threadId, started, projectId, picked, update, read])
  useEffect(() => {
    if (threadId) return
    return () => {
      const { text, images, target } = read()
      if (draftPin === undefined || target?.projectId !== draftPin) return
      if (text.trim() || images.length > 0) return
      draftPin = undefined
      update({ target: { ...target, projectId: undefined } })
    }
  }, [threadId, update, read])
  const meta = chrome?.threads.find((thread) => thread.id === threadId)
  // A message being edited can leave the queue under the composer: removed in another window, or
  // delivered once its hold lapsed. The edit stays as an ordinary draft, and the footer says why.
  const [left, setLeft] = useState<string>()
  const editingLeft = Boolean(threadId && editing && chrome && !editingEntry)
  useEffect(() => {
    if (!editingLeft || !editing) return
    setLeft(editing)
    update({ editing: undefined })
  }, [editingLeft, editing, update])
  if (left !== undefined && !draft.trim()) setLeft(undefined)
  const retrySetup = useRetrySetup()
  // Retry sends the message waiting on the worktree as the queue's Resume does, so the setup it
  // reruns reads "Setting up worktree" with Stop; with nothing waiting it only sets up.
  function retry() {
    if (!threadId) return
    const next = unsent.find((entry) => entry.id !== editing)
    if (next) queueActions.sendNow(threadId, next)
    else retrySetup(threadId)
  }
  const needsModel = !threadId && !loadout
  // Each /usage asks again; 0 is closed.
  const [usageAsked, setUsageAsked] = useState(0)
  const usageProvider = lockedProvider ?? loadout?.provider
  const usageBanner = usageAsked > 0 && usageProvider && (
    <ComposerUsage
      provider={usageProvider}
      asked={usageAsked}
      onOpen={() => void navigate({ to: '/usage' })}
      onDismiss={() => setUsageAsked(0)}
    />
  )
  function showUsage() {
    setUsageAsked((asked) => asked + 1)
  }

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
    (entry, answers, progress) => {
      if (!threadId) return
      respondQuestion(threadId, entry.id, answers, progress)
      settled(entry)
    },
    (entry, progress) => {
      if (!threadId) return
      dismissQuestion(threadId, entry.id, progress)
      settled(entry)
    },
    keepKeyboardFocus
  )
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
  // dropped on the page. Queued messages in the chat use it too.
  function keepKeyboardFocus() {
    if (document.activeElement?.matches(':focus-visible'))
      input.current?.focus({ preventScroll: true })
  }

  // Writes the prompt for the user to send, after anything already typed.
  function setUpWorktrees(guide: string) {
    const prompt = `Set up Jetty worktrees for this project. Read ${guide} and follow it.`
    if (!draft.includes(prompt)) setDraft(draft.trim() ? `${draft.trimEnd()}\n\n${prompt}` : prompt)
    input.current?.focus({ preventScroll: true })
  }

  // In the background, the new-thread page stays put with its picks for the next prompt.
  function startTurn(text: string, background: boolean) {
    const chosen = noGit ? 'local' : target?.environment
    const id =
      threadId ??
      (projectId ? createThread(projectId, chosen, environment, startingRef) : undefined)
    if (!id) return
    const kept = read().target
    clearDraft()
    const open = () => void navigate({ to: '/threads/$threadId', params: { threadId: id } })
    // Shown at once for instant feedback, and withdrawn if the send fails so Open never dangles.
    const notice =
      background && !threadId
        ? toast('Started in background', { action: { label: 'Open', onClick: open } })
        : undefined
    sendTurn(id, text, loadout, attachments.take(), draftKey, () => {
      if (notice !== undefined) toast.dismiss(notice)
    })
    if (threadId) return
    if (!background) return open()
    update({ target: kept })
  }

  function submit(background = false) {
    const text = draft.trim()
    if (threadId && editingEntry) {
      if (!text) return
      queueActions.edit(threadId, editingEntry.id, text)
    } else if (!text && attachments.images.length === 0) return
    else if (threadId && running) queueActions.add(threadId, text, attachments.take())
    else return startTurn(text, background)
    clearDraft()
  }

  // A reply set aside to edit a queued message comes back once the edit is done.
  function clearDraft() {
    setLeft(undefined)
    const reply = item && saved.parked?.[item.id]
    if (!item || reply === undefined) return update({ text: '', editing: undefined })
    const { [item.id]: _, ...parked } = saved.parked ?? {}
    update({ text: reply, editing: undefined, typedFor: item.id, parked })
  }

  // ⌘↵ while a turn runs sends straight into it, rather than queueing. Text typed during a
  // request stays a follow-up.
  const steers = Boolean(threadId) && running && !item && !editingEntry
  function steer() {
    const text = draft.trim()
    if (text || attachments.images.length > 0) startTurn(text, false)
  }

  // Edit on a queued message in the chat loads it here, sending or queueing what was typed.
  // An image still being read when Edit is pressed holds the edit back until it's ready, so the
  // message queued with it keeps it.
  function editQueued(entry: QueuedMessage) {
    if (!threadId) return
    const previous = draft.trim()
    const reply = answering && previous ? item : undefined
    const queues = !editingEntry && !reply && (previous || attachments.images.length > 0)
    if (queues && !attachments.ready) return setWaitingEdit(entry)
    if (previous && editingEntry) queueActions.edit(threadId, editingEntry.id, previous)
    else if (editingEntry) queueActions.release(threadId, editingEntry.id)
    else if (queues) queueActions.add(threadId, previous, attachments.take())
    queueActions.hold(threadId, entry.id)
    focusEdit.current = true
    update({
      text: entry.text,
      editing: entry.id,
      typedFor: undefined,
      ...(reply && { parked: { ...saved.parked, [reply.id]: draft } }),
    })
  }
  const [waitingEdit, setWaitingEdit] = useState<QueuedMessage>()
  const editWhenReady = useEffectEvent(editQueued)
  useEffect(() => {
    if (!waitingEdit || !attachments.ready) return
    setWaitingEdit(undefined)
    editWhenReady(waitingEdit)
  }, [waitingEdit, attachments.ready])
  useQueueComposer(threadId, { edit: editQueued, keepFocus: keepKeyboardFocus })

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

  const header = item && pending.length > 1 && (
    <PendingHeader index={index} total={pending.length} source={item.source} onChoose={choose} />
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
          strip: answer?.strip,
          placeholder: !threadId
            ? undefined
            : running
              ? 'Queue a follow-up while the agent works'
              : 'Ask for follow-up changes',
          sendLabel: editingEntry
            ? 'Save'
            : running
              ? item
                ? 'Queue as a follow-up'
                : 'Queue'
              : 'Send',
          sendDisabled:
            (!threadId && !projectId) || needsModel || loading || (editingEntry && !typed)
              ? true
              : undefined,
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
      {meta?.worktree?.state === 'failed' && (
        <div role='alert' className='flex items-center gap-2 pb-2 text-xs text-destructive'>
          <span>{meta.worktree.error}</span>
          <Button variant='outline' size='sm' {...pressProps(retry)}>
            Retry
          </Button>
        </div>
      )}
      <Composer
        value={draft}
        onValueChange={setDraft}
        onSubmit={mode.onSubmit}
        onBackgroundSubmit={threadId ? (steers ? steer : undefined) : () => submit(true)}
        onInterrupt={() => {
          if (threadId) interruptTurn(threadId)
        }}
        onContinue={threadId && heldByRestarts(items) ? () => continueThread(threadId) : undefined}
        running={running && !item && !editingEntry}
        strip={
          usageBanner ? (
            <>
              {usageBanner}
              {mode.strip}
            </>
          ) : (
            mode.strip
          )
        }
        placeholder={mode.placeholder}
        sendLabel={mode.sendLabel}
        sendDisabled={mode.sendDisabled}
        sendHint={
          needsModel ? (
            'Choose a model first'
          ) : steers ? (
            <span className='flex flex-col gap-1'>
              <span className='flex items-center justify-between gap-3'>
                Queue <Kbd>↵</Kbd>
              </span>
              <span className='flex items-center justify-between gap-3'>
                Steer now <Kbd>⌘↵</Kbd>
              </span>
            </span>
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
            loading={!chrome}
          />
        }
        model={loadout && findModel(catalog, loadout)}
        accessMode={accessMode}
        onAccessModeChange={setAccessMode}
        attachments={attachments}
        header={
          threadId ? (
            // Holds the project row's height so an empty thread's composer sits where the new thread's did.
            ambient && <div className='h-7' />
          ) : (
            <ComposerProject
              projectId={projectId}
              onProjectChange={(id) => {
                draftPin = undefined
                if (id !== projectId)
                  retarget({ projectId: id, environment: undefined, ref: undefined })
              }}
              onSetUpWorktrees={setupGuide ? () => setUpWorktrees(setupGuide) : undefined}
            />
          )
        }
        context={
          threadId ? (
            // Holds the environment/branch footer's height so the composer sits where it did on the new thread.
            <div className='flex w-full flex-col'>
              {meta?.backgroundTasks?.length ? (
                <MonitoringLine key={threadId} threadId={threadId} tasks={meta.backgroundTasks} />
              ) : null}
              <ThreadFooter
                threadId={threadId}
                environment={meta?.environment}
                branch={meta && threadBranch(meta)}
                path={projectPath}
                provider={provider}
                ring={!ambient}
                note={
                  editingEntry ? (
                    <span className='flex min-w-0 items-center gap-1.5'>
                      <span className='truncate'>Editing a queued message</span>
                      <Kbd>Esc</Kbd>
                    </span>
                  ) : left !== undefined ? (
                    <span className='truncate'>
                      {items.some((entry) => entry.id === left)
                        ? 'Already sent, so this is a new message'
                        : 'No longer queued, so this is a new message'}
                    </span>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ComposerFooter
              projectId={projectId}
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
        slash={{ threadId, projectId: projectId ?? meta?.projectId, onUsage: showUsage }}
      />
    </div>
  )
}
