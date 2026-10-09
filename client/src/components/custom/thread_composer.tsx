import type { Draft, DraftTarget } from '@/state'
import type { Reply, ThreadItem } from '@jetty/shared/items'
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
import { ReplyTab } from '@/components/custom/reply_quote'
import { UsageBanner } from '@/components/custom/usage_limits'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useAttachments } from '@/hooks/use-attachments'
import { useNow } from '@/hooks/use-now'
import { findModel } from '@/lib/loadout'
import { pressProps } from '@/lib/press'
import { threadBranch } from '@/lib/thread_worktree'
import {
  useAccessMode,
  useChatComposer,
  useChromeReady,
  useDefaultEnvironment,
  useContinueThread,
  useCreateThread,
  useDismissQuestion,
  useDraft,
  useInterruptTurn,
  useLoadouts,
  useNewThreadProject,
  useProject,
  useQueueActions,
  useRespondApproval,
  useRespondQuestion,
  useSendTurn,
  useThreadLoadout,
  useThreadMeta,
  useVisibleQueue,
  withQuotes,
} from '@/state'
import { createItemSelection } from '@/state/item_selection'
import { usageFreshMs, useProviderUsage, type UsageProvider } from '@/state/provider-usage'
import { useProjectGit, useRetrySetup } from '@/state/worktrees'
import { heldByRestarts } from '@jetty/shared/items'
import { worktreeSetupPrompt } from '@jetty/shared/wire'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { MonitoringLine } from './monitoring_line'
import { ThreadFooter } from './thread_footer'

const noItems: readonly ThreadItem[] = []

// How long a request must be on screen before text started in the composer answers it.
const noticeMs = 1000

// Requests for input and the subagents that ask them: a streamed reply leaves them, and the strip
// built from them, alone.
const requestItems = createItemSelection(
  (item) => item.kind === 'approval' || item.kind === 'question' || item.kind === 'subagent'
)

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
  const attachments = useAttachments(draftKey, { editing: editingEntry !== undefined })
  const { loadouts, usable, catalog, setLoadouts } = useLoadouts()
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
  const chromeReady = useChromeReady()
  const defaultEnvironment = useDefaultEnvironment()
  const selectedId = useParams({ strict: false }).threadId
  const target = saved.target
  const picked = useProject(target?.projectId) !== undefined
  const latestProject = useNewThreadProject(!threadId && !picked, selectedId)
  const projectId =
    !threadId && chromeReady ? (picked ? target?.projectId : latestProject) : undefined
  const projectGit = useProjectGit(projectId)
  const noGit = projectGit?.git === 'missing' || projectGit?.git === 'not-git'
  const projectDefault = projectGit?.git === 'ok' ? projectGit.defaultEnvironment : undefined
  const setupGuide = projectGit?.git === 'ok' ? projectGit.setupGuide : undefined
  const environment = noGit
    ? 'local'
    : (target?.environment ?? projectDefault ?? defaultEnvironment)
  const startingRef = target?.ref
  function retarget(patch: DraftTarget) {
    update({ target: { ...read().target, ...patch } })
  }
  // A started draft keeps the project it was started in, though a thread elsewhere may become the
  // most recent while it's written. Emptied and left, it lets go, so coming back follows the most
  // recent thread again; a picked project stays.
  const started = draft.trim() !== '' || attachments.items.length > 0
  useEffect(() => {
    if (threadId || !started || !projectId || picked) return
    draftPin = projectId
    update({ target: { ...read().target, projectId } })
  }, [threadId, started, projectId, picked, update, read])
  useEffect(() => {
    if (threadId) return
    return () => {
      const { text, attachments: staged, target } = read()
      if (draftPin === undefined || target?.projectId !== draftPin) return
      if (text.trim() || staged.length > 0) return
      draftPin = undefined
      update({ target: { ...target, projectId: undefined } })
    }
  }, [threadId, update, read])
  const meta = useThreadMeta(threadId)
  // A message being edited can leave the queue under the composer: removed in another window, or
  // delivered once its hold lapsed. The edit stays as an ordinary draft, and the footer says why.
  const [left, setLeft] = useState<string>()
  const editingLeft = Boolean(threadId && editing && chromeReady && !editingEntry)
  useEffect(() => {
    if (!editingLeft || !editing) return
    setLeft(editing)
    update({ editing: undefined })
  }, [editingLeft, editing, update])
  if (left !== undefined && !draft.trim()) setLeft(undefined)
  const retrySetup = useRetrySetup()
  // Resume on a waiting message is the control, and it reruns setup. Retry is only there when
  // nothing is waiting, so it just sets the worktree up.
  function retry() {
    if (threadId) retrySetup(threadId)
  }
  const worktree = meta?.worktree
  const setupNotice = worktree?.state === 'failed' || worktree?.state === 'stopped'
  const messageHeld = Boolean(meta?.queuePaused && unsent.length > 0)
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

  const requests = requestItems(items)
  const pending = useMemo(
    () => pendingItems(requests, { provider, projectPath, projectTitle }),
    [requests, projectPath, projectTitle, provider]
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
    const rest = { ...saved.parked }
    delete rest[next.id]
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
  const modelMenuRef = useRef<(() => void) | null>(null)
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

  // Writes the prompt for the user to send, after anything already typed, and points the draft
  // at the project checkout. Jetty reads the config from there. The picker can still switch it.
  function setUpWorktrees(guide: string) {
    const prompt = worktreeSetupPrompt(guide)
    if (!draft.includes(prompt)) setDraft(draft.trim() ? `${draft.trimEnd()}\n\n${prompt}` : prompt)
    retarget({ environment: 'local' })
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
    sendTurn(id, text, loadout, attachments.take(), takeQuotes(), draftKey, () => {
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
    } else if (!text && attachments.items.length === 0) return
    else if (threadId && running) queueActions.add(threadId, text, attachments.take(), takeQuotes())
    else return startTurn(text, background)
    clearDraft()
  }

  // Quotes go with the next new message, not with an edit to a queued one.
  function takeQuotes() {
    const { quotes } = read()
    if (quotes) update({ quotes: undefined })
    return quotes
  }

  // Reply and Add to prompt in the chat: each adds a quote, then on to what's typed after it.
  function quote(reply: Reply) {
    update({ quotes: withQuotes(read().quotes, [reply]) })
    const element = input.current
    element?.focus({ preventScroll: true })
    element?.setSelectionRange(element.value.length, element.value.length)
  }

  // A reply set aside to edit a queued message comes back once the edit is done.
  function clearDraft() {
    setLeft(undefined)
    const reply = item && saved.parked?.[item.id]
    if (!item || reply === undefined) return update({ text: '', editing: undefined })
    const parked = { ...saved.parked }
    delete parked[item.id]
    update({ text: reply, editing: undefined, typedFor: item.id, parked })
  }

  // ⌘↵ while a turn runs sends straight into it, rather than queueing. Text typed during a
  // request stays a follow-up.
  const steers = Boolean(threadId) && running && !item && !editingEntry
  function steer() {
    const text = draft.trim()
    if (text || attachments.items.length > 0) startTurn(text, false)
  }

  // Edit on a queued message in the chat loads it here, sending or queueing what was typed.
  // An image still being read when Edit is pressed holds the edit back until it's ready, so the
  // message queued with it keeps it.
  function editQueued(entry: QueuedMessage) {
    if (!threadId) return
    const previous = draft.trim()
    const reply = answering && previous ? item : undefined
    const queues = !editingEntry && !reply && (previous || attachments.items.length > 0)
    if (queues && !attachments.ready) return setWaitingEdit(entry)
    if (previous && editingEntry) queueActions.edit(threadId, editingEntry.id, previous)
    else if (editingEntry) queueActions.release(threadId, editingEntry.id)
    else if (queues) queueActions.add(threadId, previous, attachments.take(), takeQuotes())
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
  useChatComposer(threadId, { edit: editQueued, quote, keepFocus: keepKeyboardFocus })

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

  const followUp = Boolean(item && typed && !answering)
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
              followUp={followUp}
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
                followUp={followUp}
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
            if (event.key !== 'Escape') return false
            if (editing) {
              if (threadId) queueActions.release(threadId, editing)
              clearDraft()
            } else if (saved.quotes) update({ quotes: withQuotes(saved.quotes.slice(0, -1)) })
            else return false
            return true
          }),
        }

  return (
    <div data-chat-composer className='mx-auto w-full max-w-[708px] px-6 pb-1'>
      {worktree && setupNotice && (
        <div
          role={worktree.state === 'failed' ? 'alert' : 'status'}
          className='flex items-center gap-2 pb-2 text-xs'
        >
          <span
            className={worktree.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}
          >
            {worktree.error}
          </span>
          {!messageHeld && (
            <Button variant='outline' size='sm' {...pressProps(retry)}>
              Retry
            </Button>
          )}
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
        onChooseModel={needsModel ? () => modelMenuRef.current?.() : undefined}
        running={running && !item && !editingEntry}
        stop={
          running &&
          !editingEntry &&
          answering &&
          item?.kind === 'approval' &&
          !approval.confirming &&
          !typed
        }
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
        reply={saved.quotes?.map((reply, index) => (
          <ReplyTab
            key={`${reply.itemId}:${reply.text}`}
            text={reply.text}
            onClear={() => update({ quotes: withQuotes(saved.quotes?.toSpliced(index, 1)) })}
            className='mx-1 mt-1 self-stretch rounded-[calc(var(--radius-md)-4px)]'
          />
        ))}
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
            usable={usable}
            value={loadout}
            lockedProvider={lockedProvider}
            onChange={setLoadout}
            onReorder={setLoadouts}
            onOpenSettings={() =>
              void navigate({ to: '/settings/$page', params: { page: 'models' } })
            }
            loading={!chromeReady}
            modelMenuRef={modelMenuRef}
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
                readOnly={meta?.readOnly}
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
