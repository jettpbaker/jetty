import type { SecretItem } from '@/components/custom/thread_rows'
import type { Reply, ThreadItem } from '@jetty/shared/items'
import type { Bot, QueuedMessage } from '@jetty/shared/wire'

import { botColorStyle } from '@/components/custom/bot_avatar'
import { BotConversation, type Room } from '@/components/custom/bot_conversation'
import { BotDecisionCard } from '@/components/custom/bot_decision_card'
import { Composer } from '@/components/custom/composer'
import { SecretStrip } from '@/components/custom/composer_strip'
import { BotLoadoutPicker, botLoadoutChanges } from '@/components/custom/new_bot_dialog'
import {
  ComposerQueue,
  QueuedEditNote,
  QueueOrSteerHint,
  showsQueue,
  useComposerQueue,
  useEditLeftQueue,
} from '@/components/custom/queued_messages'
import { ReplyTab } from '@/components/custom/reply_quote'
import { linkMentions, unlinkMentions } from '@/components/custom/slash_model'
import { ThreadFooter } from '@/components/custom/thread_footer'
import { ThreadList } from '@/components/custom/thread_list'
import { useAttachments } from '@/hooks/use-attachments'
import { useShowQuietTurns } from '@/lib/bot-quiet-turns'
import { findModel } from '@/lib/loadout'
import {
  useBotPresence,
  useBots,
  useChatComposer,
  useChromeReady,
  useDraft,
  useInterruptTurn,
  usePendingBotMessages,
  useProject,
  useQueueActions,
  useRespondSecret,
  useSendToBot,
  useModels,
  useThreadStructure,
  useThreadOverlay,
  useUpdateBot,
  withQuotes,
} from '@/state'
import { pendingTurnId } from '@/state/turns'
import { quietTurn } from '@jetty/shared/bots'
import { awaitsInput } from '@jetty/shared/items'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'

// `overlayHost` is the page the bots' conversation opens over.
export function BotChat({ bot, overlayHost }: { bot: Bot; overlayHost: HTMLElement | null }) {
  const thread = useThreadStructure(bot.id)
  const pending = usePendingBotMessages(bot.id)
  const bots = useBots()
  const [showQuiet] = useShowQuietTurns()
  const others = useMemo(() => bots.filter((other) => other.id !== bot.id), [bots, bot.id])
  const tidying = bot.activity === 'tidying' && !showQuiet
  const rowOptions = useMemo(
    () => ({ others: new Set(others.map((other) => other.id)), showQuiet, tidying }),
    [others, showQuiet, tidying]
  )
  const [room, setRoom] = useState<Room>()
  const project = useProject(bot.projectId ?? undefined)
  const sendToBot = useSendToBot()
  const respondSecret = useRespondSecret()
  const interrupt = useInterruptTurn()
  const updateBot = useUpdateBot()
  const navigate = useNavigate()
  const models = useModels()
  const queueActions = useQueueActions()
  const chromeReady = useChromeReady()
  // Quotes live in the draft, like a thread's, so a failed send brings them back with the text.
  const { draft, update: updateDraft, read: readDraft } = useDraft(bot.id)
  const replies = draft.quotes
  const setReplies = (quotes: readonly Reply[] | undefined) => updateDraft({ quotes })
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const overlay = useThreadOverlay(bot.id, thread)
  const composerQueue = useComposerQueue(bot.id, overlay.serverItems)
  const editingEntry = composerQueue?.own.find((entry) => entry.id === draft.editing)
  const attachments = useAttachments(bot.id, { editing: editingEntry !== undefined })
  const items = useMemo(
    () => [
      ...overlay.items,
      ...pending.map(
        (message): ThreadItem => ({
          kind: 'user_message',
          id: message.id,
          turnId: pendingTurnId,
          createdAt: message.sentAt,
          text: message.text,
          attachments: message.attachments,
          ...(message.replies?.length && { replies: message.replies }),
        })
      ),
    ],
    [overlay.items, pending]
  )
  const turnId = thread?.activeTurnId
  // Only the bot's own card stops its turn; a worker waiting on Jett leaves it working.
  const asking = overlay.serverItems.some(awaitsInput)
  // Stop lasts the whole turn, but not a turn Jetty started on its own until the bot speaks.
  const stoppable = turnId ? !asking && !quietTurn(items, turnId) : false
  // A message goes straight in while the bot looks idle, even mid check-in. Otherwise it queues,
  // including behind messages already waiting.
  const secret = overlay.serverItems.find(
    (item): item is SecretItem => item.kind === 'secret_request' && awaitsInput(item)
  )
  // A message sent over an open secret request closes it, so it never queues.
  const busy =
    !secret &&
    (stoppable || pending.length > 0 || Boolean(composerQueue?.own.length && !composerQueue.paused))
  const typed = draft.text.trim()
  const empty = !typed && attachments.items.length === 0
  useBotPresence(bot.id, !empty)
  const [left, setLeft] = useEditLeftQueue(
    draft.editing,
    Boolean(draft.editing && chromeReady && !editingEntry),
    !typed,
    updateDraft
  )
  function clearDraft() {
    setLeft(undefined)
    updateDraft({ text: '', quotes: undefined, editing: undefined })
  }
  // ⌘↵ while the bot works sends straight into its turn; otherwise it's how any message goes.
  function steer() {
    if (empty) return
    sendToBot(bot.id, linkMentions(typed, others), replies, [], attachments.take(), bot.id)
    clearDraft()
  }
  function submit() {
    if (editingEntry) {
      if (!typed) return
      queueActions.edit(bot.id, editingEntry.id, linkMentions(typed, others))
      return clearDraft()
    }
    if (!busy) return steer()
    if (empty) return
    queueActions.add(bot.id, linkMentions(typed, others), attachments.take(), replies)
    clearDraft()
  }
  function reply(quote: Reply) {
    setReplies(withQuotes(readDraft().quotes, [quote]))
    fieldRef.current?.focus()
  }
  const focusEdit = useRef(false)
  // The Edit button unmounts as its row turns into "Editing"; the loaded draft takes focus.
  useLayoutEffect(() => {
    const element = fieldRef.current
    if (!focusEdit.current || !element) return
    focusEdit.current = false
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
  }, [draft.editing])
  // Edit on a queued message loads it here, queueing what was typed. An image still being read
  // holds the edit back until it's ready, so the message queued with it keeps it.
  function editQueued(entry: QueuedMessage) {
    const queues = !editingEntry && !empty
    if (queues && !attachments.ready) return setWaitingEdit(entry)
    if (typed && editingEntry)
      queueActions.edit(bot.id, editingEntry.id, linkMentions(typed, others))
    else if (editingEntry) queueActions.release(bot.id, editingEntry.id)
    else if (queues)
      queueActions.add(bot.id, linkMentions(typed, others), attachments.take(), replies)
    queueActions.hold(bot.id, entry.id)
    focusEdit.current = true
    updateDraft({
      text: unlinkMentions(entry.text),
      editing: entry.id,
      ...(queues && { quotes: undefined }),
    })
  }
  const [waitingEdit, setWaitingEdit] = useState<QueuedMessage>()
  const editWhenReady = useEffectEvent(editQueued)
  useEffect(() => {
    if (!waitingEdit || !attachments.ready) return
    setWaitingEdit(undefined)
    editWhenReady(waitingEdit)
  }, [waitingEdit, attachments.ready])
  // Steer and Remove unmount their button; a keyboard user would otherwise be dropped on the page.
  function keepFocus() {
    if (document.activeElement?.matches(':focus-visible'))
      fieldRef.current?.focus({ preventScroll: true })
  }
  useChatComposer(bot.id, { edit: editQueued, quote: reply, keepFocus })
  const steers = busy && !editingEntry
  return (
    <div
      className='relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background'
      style={botColorStyle(bot.color)}
    >
      {thread || items.length > 0 ? (
        <ThreadList
          threadId={bot.id}
          history={thread?.history}
          summary={thread?.summary}
          items={items}
          status={thread?.status ?? 'idle'}
          running={overlay.running || pending.length > 0}
          outcomes={thread?.turnOutcomes}
          loadouts={thread?.turnLoadouts}
          projectPath={project?.path}
          provider={bot.provider}
          bot={rowOptions}
          onOpenRoom={setRoom}
        />
      ) : (
        <div className='min-h-0 flex-1' />
      )}
      <div className='mx-auto flex w-full max-w-[873px] shrink-0 flex-col gap-2 px-6 pb-1'>
        {overlay.serverItems.map(
          (item) =>
            (item.kind === 'approval' || item.kind === 'question') &&
            awaitsInput(item) && <BotDecisionCard key={item.id} item={item} bot={bot} />
        )}
        <Composer
          value={draft.text}
          onValueChange={(text) => updateDraft({ text })}
          onSubmit={submit}
          onBackgroundSubmit={steers ? steer : undefined}
          onInterrupt={() => interrupt(bot.id)}
          running={busy && !editingEntry}
          strip={
            (showsQueue(composerQueue) && composerQueue) || secret ? (
              <>
                {showsQueue(composerQueue) && composerQueue && (
                  <ComposerQueue threadId={bot.id} queue={composerQueue} running={busy} />
                )}
                {secret && (
                  <SecretStrip
                    key={secret.id}
                    item={{
                      id: secret.id,
                      kind: secret.kind,
                      source: { kind: 'main' },
                      label: secret.label,
                      reason: secret.reason,
                    }}
                    composerHasText={Boolean(typed)}
                    respond={(value) => respondSecret(bot.id, secret.id, value)}
                  />
                )}
              </>
            ) : undefined
          }
          placeholder={
            secret
              ? `Tell ${bot.name} what to do instead`
              : busy
                ? `Queue a follow-up while ${bot.name} works`
                : `Message ${bot.name}`
          }
          sendLabel={editingEntry ? 'Save' : busy ? 'Queue' : 'Send'}
          sendDisabled={editingEntry && !typed ? true : undefined}
          sendHint={steers ? <QueueOrSteerHint /> : undefined}
          reply={replies?.map((reply, index) => (
            <ReplyTab
              key={`${reply.itemId}:${reply.text}`}
              text={reply.text}
              onClear={() => setReplies(withQuotes(replies.toSpliced(index, 1)))}
              className='mx-1 mt-1 self-stretch rounded-[calc(var(--radius-md)-4px)]'
            />
          ))}
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.key !== 'Escape') return
            if (draft.editing) {
              queueActions.release(bot.id, draft.editing)
              clearDraft()
            } else if (replies) setReplies(withQuotes(replies.slice(0, -1)))
            else return
            event.preventDefault()
          }}
          loadout={
            <BotLoadoutPicker
              value={bot}
              onChange={(next) => {
                const changes = botLoadoutChanges(bot, next)
                if (Object.keys(changes).length) updateBot(bot.id, changes)
              }}
              onOpenSettings={() =>
                void navigate({ to: '/settings/$page', params: { page: 'models' } })
              }
            />
          }
          model={findModel(models, bot)}
          accessMode={bot.permissionMode}
          onAccessModeChange={(permissionMode) => updateBot(bot.id, { permissionMode })}
          attachments={attachments}
          context={
            <ThreadFooter
              threadId={bot.id}
              provider={bot.provider}
              ring
              note={
                editingEntry ? (
                  <QueuedEditNote items={overlay.serverItems} />
                ) : left !== undefined ? (
                  <QueuedEditNote left={left} items={overlay.serverItems} />
                ) : undefined
              }
            />
          }
          rows={1}
          inputRef={fieldRef}
          slash={{
            projectId: bot.projectId ?? undefined,
            provider: bot.provider,
            botId: bot.id,
            mentions: others,
          }}
        />
      </div>
      {room && (
        <BotConversation
          key={room.botId}
          bot={bot}
          room={room}
          host={overlayHost}
          onClose={() => setRoom(undefined)}
        />
      )}
    </div>
  )
}
