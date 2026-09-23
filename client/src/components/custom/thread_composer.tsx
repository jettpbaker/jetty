import type { ThreadItem } from '@jetty/shared/items'
import type { QueuedMessage } from '@jetty/shared/wire'

import { Composer } from '@/components/custom/composer'
import { ComposerFooter } from '@/components/custom/composer_footer'
import { ComposerLoadout } from '@/components/custom/composer_loadout'
import {
  ApprovalStrip,
  QuestionStrip,
  QueueTray,
  SeveralHeader,
  TodoLine,
  useApproval,
  useQuestion,
} from '@/components/custom/composer_strip'
import { currentTodos, pendingItems } from '@/components/custom/composer_strip_model'
import { useImageAttachments } from '@/hooks/use-image-attachments'
import { findModel } from '@/lib/loadout'
import { newThreadProject } from '@/lib/thread_project'
import {
  useAccessMode,
  useChrome,
  useCreateThread,
  useDismissQuestion,
  useInterruptTurn,
  useLoadouts,
  useQueueActions,
  useRespondApproval,
  useRespondQuestion,
  useSendTurn,
  useThreadLoadout,
  useThreadQueue,
} from '@/state'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

const noItems: readonly ThreadItem[] = []

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
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string>()
  const [chosen, setChosen] = useState(0)
  const attachments = useImageAttachments()
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
  const projectId =
    !threadId && chrome ? (pickedProjectId ?? newThreadProject(chrome, selectedId)) : undefined
  const needsModel = !threadId && !loadout

  const pending = useMemo(
    () => pendingItems(items, { provider, projectPath, projectTitle }),
    [items, projectPath, projectTitle, provider]
  )
  const index = Math.max(0, Math.min(chosen, pending.length - 1))
  const item = pending[index]
  const approval = useApproval(
    item?.kind === 'approval' ? item : undefined,
    draft,
    setDraft,
    (entry, decision, note) => {
      if (!threadId) return
      if (decision === 'deny') respondApproval(threadId, entry.id, 'deny', note)
      else
        respondApproval(
          threadId,
          entry.id,
          'allow',
          undefined,
          decision === 'always' ? entry.suggestions : undefined
        )
    }
  )
  const question = useQuestion(
    item?.kind === 'question' ? item : undefined,
    draft,
    setDraft,
    (entry, answers) => threadId && respondQuestion(threadId, entry.id, answers),
    (entry) => threadId && dismissQuestion(threadId, entry.id)
  )
  const todos = useMemo(() => currentTodos(items), [items])
  const todo =
    running &&
    (todos.find((entry) => entry.status === 'active') ??
      todos.find((entry) => entry.status === 'pending'))
  const editingEntry = queue.find((entry) => entry.id === editing)
  const steering = attachments.images.length > 0

  function priorCount(text: string) {
    return items.filter((entry) => entry.kind === 'user_message' && entry.text === text).length
  }

  function startTurn(text: string) {
    const id = threadId ?? (projectId ? createThread(projectId) : undefined)
    if (!id) return
    const prior = priorCount(text)
    setDraft('')
    sendTurn(id, text, prior, loadout, attachments.take())
    if (!threadId) void navigate({ to: '/threads/$threadId', params: { threadId: id } })
  }

  function submit() {
    const text = draft.trim()
    if (!text && attachments.images.length === 0) return
    if (threadId && text && editingEntry) queueActions.edit(threadId, editingEntry.id, text)
    else if (threadId && text && running && !steering) queueActions.add(threadId, text)
    else return startTurn(text)
    setEditing(undefined)
    setDraft('')
  }

  function changeDraft(value: string) {
    setDraft(value)
    if (!value.trim()) setEditing(undefined)
  }

  const queueControl = {
    queue,
    running,
    editing,
    sendNow(entry: QueuedMessage) {
      if (!threadId) return
      if (running) return queueActions.steer(threadId, entry.id)
      queueActions.remove(threadId, entry.id)
      sendTurn(threadId, entry.text, priorCount(entry.text), loadout)
    },
    edit(entry: QueuedMessage) {
      if (!threadId) return
      const previous = draft.trim()
      if (previous && editingEntry) queueActions.edit(threadId, editingEntry.id, previous)
      else if (previous) queueActions.add(threadId, previous)
      setEditing(entry.id)
      setDraft(entry.text)
    },
    remove(entry: QueuedMessage) {
      if (threadId) queueActions.remove(threadId, entry.id)
    },
  }

  const header = pending.length > 1 && item && (
    <SeveralHeader
      index={index}
      total={pending.length}
      source={item.source}
      queued={queue.length}
      onChoose={setChosen}
    />
  )

  function keyHandler(handle: (event: KeyboardEvent) => boolean) {
    return (event: KeyboardEvent) => {
      if (!event.defaultPrevented && handle(event)) event.preventDefault()
    }
  }

  const typed = draft.trim() !== ''
  const mode =
    item?.kind === 'approval'
      ? {
          strip: (
            <ApprovalStrip
              item={item}
              ctl={approval}
              typed={typed}
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
        : {
            strip:
              queue.length > 0 ? (
                <QueueTray q={queueControl} />
              ) : todo ? (
                <TodoLine list={todos} current={todo} />
              ) : undefined,
            placeholder: !threadId
              ? undefined
              : running
                ? 'Queue a follow-up while the agent works'
                : 'Ask for follow-up changes',
            sendLabel: running ? (steering ? 'Steer' : 'Queue') : 'Send',
            sendDisabled: (!threadId && !projectId) || needsModel ? true : undefined,
            onSubmit: submit,
            onKeyDown: keyHandler((event) => {
              if (event.key !== 'Escape' || !editing) return false
              setEditing(undefined)
              setDraft('')
              return true
            }),
          }

  return (
    <div className='mx-auto w-full max-w-[708px] px-6 pb-1'>
      <Composer
        value={draft}
        onValueChange={changeDraft}
        onSubmit={mode.onSubmit}
        onInterrupt={() => {
          if (threadId) interruptTurn(threadId)
        }}
        running={running && !item}
        strip={mode.strip}
        placeholder={mode.placeholder}
        sendLabel={mode.sendLabel}
        sendDisabled={mode.sendDisabled}
        sendHint={needsModel ? 'Choose a model first' : undefined}
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
          threadId ? undefined : (
            <ComposerFooter projectId={projectId} onProjectChange={setPickedProjectId} />
          )
        }
        rows={rows}
        ambient={ambient}
      />
    </div>
  )
}
