import type { Attachment, Reply } from '@jetty/shared/items'
import type { Bot, BotAllowRule, BotConversationMessage, ParamsOf } from '@jetty/shared/wire'

import { unlinkMentions } from '@/components/custom/slash_model'
import { shownAttachment, uploadAttachment, type ReadyAttachment } from '@/hooks/use-attachments'
import { resendOnDrop, type Connection } from '@/net/connection'
import { useAtomValue } from '@effect/atom-react'
import { hasMessage } from '@jetty/shared/history'
import { Effect, Equal } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { chromeAtom, serverChrome } from './chrome'
import { connectionAtom, run, subscribe, useAction } from './connection'
import { stageSend } from './drafts'
import { settleWhen, trackCreation, without, withoutId } from './mutations'
import { threadStructureAtom } from './threads'

type Registry = AtomRegistry.AtomRegistry

type NewBot = Omit<ParamsOf<'bot.create'>, 'id'>

// Shown in the chat from the moment it's sent, until the bot's thread has it.
type PendingBotMessage = {
  id: string
  text: string
  replies?: readonly Reply[]
  attachments: readonly Attachment[]
  sentAt: number
}

// Bots this tab created that the server hasn't listed yet, and changes it hasn't confirmed.
const createdBotsAtom = Atom.make<ReadonlyMap<string, Bot>>(new Map()).pipe(Atom.keepAlive)
const botPatchesAtom = Atom.make<ReadonlyMap<string, Partial<Bot>>>(new Map()).pipe(Atom.keepAlive)
const deletedBotsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive)
const pendingMessagesAtom = Atom.make<ReadonlyMap<string, readonly PendingBotMessage[]>>(
  new Map()
).pipe(Atom.keepAlive)

const noBots: readonly Bot[] = []
const noPending: readonly PendingBotMessage[] = []

export const botsAtom = Atom.readable((get) => {
  const listed = get(chromeAtom)?.bots ?? noBots
  const created = get(createdBotsAtom)
  const patches = get(botPatchesAtom)
  const deleted = get(deletedBotsAtom)
  if (!created.size && !patches.size && !deleted.size) return listed
  const known = new Set(listed.map((bot) => bot.id))
  return [...listed, ...[...created.values()].filter((bot) => !known.has(bot.id))]
    .filter((bot) => !deleted.has(bot.id))
    .map((bot) => {
      const patch = patches.get(bot.id)
      return patch ? { ...bot, ...patch } : bot
    })
}).pipe(Atom.withEquality(Equal.equals))

const activeBotsAtom = Atom.readable((get) => get(botsAtom).filter((bot) => !bot.archived)).pipe(
  Atom.withEquality(Equal.equals)
)

const archivedBotsAtom = Atom.readable((get) => get(botsAtom).filter((bot) => bot.archived)).pipe(
  Atom.withEquality(Equal.equals)
)

export function useBots() {
  return useAtomValue(activeBotsAtom)
}

const botIdsAtom = Atom.readable((get) =>
  get(botsAtom)
    .map((bot) => bot.id)
    .sort()
    .join('\0')
)

export function useBotIds() {
  const ids = useAtomValue(botIdsAtom)
  return useMemo(() => new Set(ids ? ids.split('\0') : []), [ids])
}

export function useArchivedBots() {
  return useAtomValue(archivedBotsAtom)
}

const botAtom = Atom.family((botId: string) =>
  Atom.readable((get) => get(botsAtom).find((bot) => bot.id === botId)).pipe(
    Atom.withEquality(Equal.equals)
  )
)

// Also finds who sent a worker its message: a bot's chat thread has the bot's id.
export function useBot(botId: string | undefined) {
  return useAtomValue(botAtom(botId ?? ''))
}

function toastFailure<A, E extends { message: string }>(effect: Effect.Effect<A, E>) {
  return effect.pipe(Effect.tapError((error) => Effect.sync(() => toast.error(error.message))))
}

function serverBot(registry: Registry, botId: string) {
  return serverChrome(registry)?.bots.find((bot) => bot.id === botId)
}

function createBot(registry: Registry, bot: NewBot) {
  const id = crypto.randomUUID()
  registry.update(createdBotsAtom, (bots) =>
    new Map(bots).set(id, {
      ...bot,
      id,
      createdAt: Date.now(),
      // It speaks first.
      activity: 'typing',
      needsYou: false,
      failed: false,
      unread: false,
      archived: false,
      checkIns: true,
      tasks: [],
    })
  )
  const forget = () => registry.update(createdBotsAtom, (bots) => without(bots, [id]))
  const creation = run(
    registry,
    (connection) =>
      resendOnDrop(connection.request('bot.create', { ...bot, id })).pipe(
        Effect.tap(() =>
          Effect.sync(() => settleWhen(registry, () => !!serverBot(registry, id), forget))
        ),
        toastFailure
      ),
    forget
  )
  trackCreation(id, creation)
  return id
}

export const useCreateBot = () => useAction(createBot)

// Shows a change to a bot at once, and holds it until the server's list agrees or the request
// fails. `send` answers with the bot when the server may settle on other values than those asked.
function patchBot<E>(
  registry: Registry,
  botId: string,
  patch: Partial<Bot>,
  send: (connection: Connection) => Effect.Effect<Bot | void, E>
) {
  const keys = Object.keys(patch) as (keyof Bot)[]
  registry.update(botPatchesAtom, (patches) =>
    new Map(patches).set(botId, { ...patches.get(botId), ...patch })
  )
  // Only what this change still holds, so a newer change to the same key outlives an older reply.
  const clear = () =>
    registry.update(botPatchesAtom, (patches) => {
      const rest = { ...patches.get(botId) }
      for (const key of keys) if (rest[key] === patch[key]) delete rest[key]
      return Object.keys(rest).length
        ? new Map(patches).set(botId, rest)
        : without(patches, [botId])
    })
  run(
    registry,
    (connection) =>
      send(connection).pipe(
        Effect.tap((settled) =>
          Effect.sync(() =>
            settleWhen(
              registry,
              () => {
                const listed = serverBot(registry, botId)
                return (
                  !!listed &&
                  keys.every((key) => Equal.equals(listed[key], (settled ?? patch)[key]))
                )
              },
              clear
            )
          )
        )
      ),
    clear
  )
}

function markBotSeen(registry: Registry, botId: string) {
  patchBot(registry, botId, { unread: false }, (connection) =>
    connection.request('bot.markSeen', { botId }).pipe(Effect.asVoid)
  )
}

export const useMarkBotSeen = () => useAction(markBotSeen)

function dropPending(registry: Registry, botId: string, messageId: string) {
  registry.update(pendingMessagesAtom, (map) => {
    const rest = (map.get(botId) ?? noPending).filter((message) => message.id !== messageId)
    return rest.length ? new Map(map).set(botId, rest) : without(map, [botId])
  })
}

function listed(registry: Registry, botId: string, messageId: string) {
  return hasMessage(registry.get(threadStructureAtom(botId)), messageId)
}

function sendToBot(
  registry: Registry,
  botId: string,
  text: string,
  replies?: readonly Reply[],
  // Attachments the bot's thread already holds (Retry), or new ones from the composer.
  held: readonly Attachment[] = [],
  attachments: readonly ReadyAttachment[] = [],
  // The composer it came from, which gets it back if the send fails.
  fromDraft?: string
) {
  const message: PendingBotMessage = {
    id: crypto.randomUUID(),
    text,
    ...(replies?.length && { replies }),
    attachments: [...held, ...attachments.map(shownAttachment)],
    sentAt: Date.now(),
  }
  const staged = stageSend(registry, fromDraft, {
    text: unlinkMentions(text),
    attachments,
    quotes: replies,
    sent: { threadId: botId, messageId: message.id },
  })
  registry.update(pendingMessagesAtom, (map) =>
    new Map(map).set(botId, [...(map.get(botId) ?? noPending), message])
  )
  const drop = () => dropPending(registry, botId, message.id)
  run(
    registry,
    (connection) =>
      resendOnDrop(
        connection.request('bot.send', {
          botId,
          messageId: message.id,
          text,
          ...(held.length && {
            attachmentIds: held.map((attachment) => attachment.id),
          }),
          ...(attachments.length && {
            attachments: attachments.map(uploadAttachment),
          }),
          ...(replies?.length && { replies }),
        })
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            staged.sent()
            if (listed(registry, botId, message.id)) return drop()
            const stop = registry.subscribe(threadStructureAtom(botId), () => {
              if (!listed(registry, botId, message.id)) return
              stop()
              drop()
            })
          })
        ),
        toastFailure
      ),
    () => {
      drop()
      if (fromDraft !== undefined) staged.failed(fromDraft)
    }
  )
  return message.id
}

export const useSendToBot = () => useAction(sendToBot)

const pendingAtom = Atom.family((botId: string) =>
  Atom.readable((get) => {
    const pending = get(pendingMessagesAtom).get(botId) ?? noPending
    if (!pending.length) return pending
    const state = get(threadStructureAtom(botId))
    return pending.filter((message) => !hasMessage(state, message.id))
  }).pipe(Atom.withEquality(Equal.equals))
)

// Jett's messages the bot's thread doesn't have yet, oldest first.
export function usePendingBotMessages(botId: string) {
  return useAtomValue(pendingAtom(botId))
}

// Mounted while the bot's chat is on screen: Jetty compacts the bot only while Jett is away from
// it, and never under a draft.
const presenceAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const [botId = '', draft] = key.split('|')
    return subscribe(get, (connection) => connection.watchBotPresence(botId, draft === 'draft'))
  })
)

export function useBotPresence(botId: string, draft: boolean) {
  useAtomValue(presenceAtom(`${botId}|${draft ? 'draft' : 'empty'}`))
}

// Two bots' conversation, one entry per pair whichever chat it's read from.
const conversationAtom = Atom.family((_pair: string) =>
  Atom.make<readonly BotConversationMessage[] | undefined>(undefined).pipe(
    Atom.setIdleTTL('30 minutes')
  )
)

// One fetch per version of the conversation; the last answer stays on screen while it runs.
const conversationFetchAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const [pair = ''] = key.split('|')
    const [botId = '', otherBotId = ''] = pair.split(':')
    return get.result(connectionAtom).pipe(
      Effect.flatMap((connection) => connection.request('bot.conversation', { botId, otherBotId })),
      Effect.tap(({ messages }) => Effect.sync(() => get.set(conversationAtom(pair), messages)))
    )
  }).pipe(Atom.setIdleTTL('1 minute'))
)

const shownConversationAtom = Atom.family((key: string) =>
  Atom.readable((get) => {
    get(conversationFetchAtom(key))
    return get(conversationAtom(key.split('|')[0]!))
  })
)

// What two bots sent each other, oldest first; a new version fetches it again.
export function useBotConversation(botId: string, otherBotId: string, version: string) {
  const pair = botId < otherBotId ? `${botId}:${otherBotId}` : `${otherBotId}:${botId}`
  return useAtomValue(shownConversationAtom(`${pair}|${version}`))
}

function setBotAllowRules(registry: Registry, botId: string, rules: readonly BotAllowRule[]) {
  patchBot(registry, botId, { allowRules: rules }, (connection) =>
    connection.request('bot.setAllowRules', { botId, rules }).pipe(Effect.asVoid, toastFailure)
  )
}

export const useSetBotAllowRules = () => useAction(setBotAllowRules)

type BotUpdate = Omit<ParamsOf<'bot.update'>, 'botId'>

function updateBot(registry: Registry, botId: string, update: BotUpdate) {
  patchBot(registry, botId, update, (connection) =>
    connection.request('bot.update', { botId, ...update }).pipe(
      Effect.map(({ bot }) => bot),
      toastFailure
    )
  )
}

export const useUpdateBot = () => useAction(updateBot)

function archiveBot(registry: Registry, botId: string, archived: boolean) {
  patchBot(registry, botId, { archived }, (connection) =>
    connection.request('bot.archive', { botId, archived }).pipe(Effect.asVoid, toastFailure)
  )
}

export const useArchiveBot = () => useAction(archiveBot)

function deleteBot(registry: Registry, botId: string) {
  registry.update(deletedBotsAtom, (ids) => new Set(ids).add(botId))
  const rollback = () => registry.update(deletedBotsAtom, (ids) => withoutId(ids, botId))
  run(
    registry,
    (connection) =>
      connection.request('bot.delete', { botId }).pipe(
        Effect.tap(() =>
          Effect.sync(() => settleWhen(registry, () => !serverBot(registry, botId), rollback))
        ),
        toastFailure
      ),
    rollback
  )
}

export const useDeleteBot = () => useAction(deleteBot)
