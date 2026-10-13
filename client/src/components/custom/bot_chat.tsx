import type { Reply, ThreadItem } from '@jetty/shared/items'
import type { Bot } from '@jetty/shared/wire'

import { botColorStyle } from '@/components/custom/bot_avatar'
import { BotConversation, type Room } from '@/components/custom/bot_conversation'
import { BotDecisionCard } from '@/components/custom/bot_decision_card'
import { Composer } from '@/components/custom/composer'
import { BotLoadoutPicker, botLoadoutChanges } from '@/components/custom/new_bot_dialog'
import { ReplyTab } from '@/components/custom/reply_quote'
import { linkMentions } from '@/components/custom/slash_model'
import { ThreadList } from '@/components/custom/thread_list'
import { useAttachments } from '@/hooks/use-attachments'
import { useShowQuietTurns } from '@/lib/bot-quiet-turns'
import { findModel } from '@/lib/loadout'
import {
  useBotPresence,
  useBots,
  useChatComposer,
  useDraft,
  useInterruptTurn,
  usePendingBotMessages,
  useProject,
  useSendToBot,
  useModels,
  useThread,
  useThreadOverlay,
  useUpdateBot,
  withQuotes,
} from '@/state'
import { pendingTurnId } from '@/state/turns'
import { quietTurn } from '@jetty/shared/bots'
import { awaitsInput } from '@jetty/shared/items'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'

function ignore() {}

// `overlayHost` is the page the bots' conversation opens over.
export function BotChat({ bot, overlayHost }: { bot: Bot; overlayHost: HTMLElement | null }) {
  const thread = useThread(bot.id)
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
  const interrupt = useInterruptTurn()
  const updateBot = useUpdateBot()
  const navigate = useNavigate()
  const models = useModels()
  const attachments = useAttachments(bot.id)
  // Quotes live in the draft, like a thread's, so a failed send brings them back with the text.
  const { draft, update: updateDraft, read: readDraft } = useDraft(bot.id)
  const replies = draft.quotes
  const setReplies = (quotes: readonly Reply[] | undefined) => updateDraft({ quotes })
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const overlay = useThreadOverlay(bot.id, thread)
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
  const asking = overlay.items.some(awaitsInput)
  // Stop lasts the whole turn, but not a turn Jetty started on its own until the bot speaks.
  const busy = turnId ? !asking && !quietTurn(items, turnId) : false
  const empty = !draft.text.trim() && attachments.items.length === 0
  useBotPresence(bot.id, !empty)
  function send() {
    if (empty) return
    sendToBot(
      bot.id,
      linkMentions(draft.text.trim(), others),
      replies,
      [],
      attachments.take(),
      bot.id
    )
    updateDraft({ text: '', quotes: undefined })
  }
  function reply(quote: Reply) {
    setReplies(withQuotes(readDraft().quotes, [quote]))
    fieldRef.current?.focus()
  }
  useChatComposer(bot.id, { edit: ignore, quote: reply, keepFocus: ignore })
  return (
    <div
      className='relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background'
      style={botColorStyle(bot.color)}
    >
      {thread || items.length > 0 ? (
        <ThreadList
          threadId={bot.id}
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
      <div className='mx-auto flex w-full max-w-[873px] shrink-0 flex-col gap-2 px-6 pb-4'>
        {overlay.items.map(
          (item) =>
            (item.kind === 'approval' || item.kind === 'question') &&
            awaitsInput(item) && <BotDecisionCard key={item.id} item={item} bot={bot} />
        )}
        <Composer
          value={draft.text}
          onValueChange={(text) => updateDraft({ text })}
          onSubmit={send}
          onInterrupt={() => interrupt(bot.id)}
          running={busy}
          placeholder={`Message ${bot.name}`}
          reply={replies?.map((reply, index) => (
            <ReplyTab
              key={`${reply.itemId}:${reply.text}`}
              text={reply.text}
              onClear={() => setReplies(withQuotes(replies.toSpliced(index, 1)))}
              className='mx-1 mt-1 self-stretch rounded-[calc(var(--radius-md)-4px)]'
            />
          ))}
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.key !== 'Escape' || !replies) return
            event.preventDefault()
            setReplies(withQuotes(replies.slice(0, -1)))
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
          context={null}
          rows={1}
          inputRef={fieldRef}
          slash={{
            projectId: bot.projectId ?? undefined,
            provider: bot.provider,
            bot: true,
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
