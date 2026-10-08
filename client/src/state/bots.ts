import type { Reply } from '@jetty/shared/items'
import type { Bot, ParamsOf } from '@jetty/shared/wire'

import { resendOnDrop } from '@/net/connection'
import { useAtomValue } from '@effect/atom-react'
import { Effect, Equal } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { toast } from 'sonner'

import { chromeAtom, serverChrome } from './chrome'
import { run, useAction } from './connection'
import { settleWhen, trackCreation, without } from './mutations'
import { threadAtom } from './threads'

type Registry = AtomRegistry.AtomRegistry

export type NewBot = Omit<ParamsOf<'bot.create'>, 'id'>

// Shown in the chat from the moment it's sent, until the bot's thread has it.
export type PendingBotMessage = {
  id: string
  text: string
  replyTo?: Reply
  sentAt: number
}

// Bots this tab created that the server hasn't listed yet, and changes it hasn't confirmed.
const createdBotsAtom = Atom.make<ReadonlyMap<string, Bot>>(new Map()).pipe(Atom.keepAlive)
const botPatchesAtom = Atom.make<ReadonlyMap<string, Partial<Bot>>>(new Map()).pipe(Atom.keepAlive)
const pendingMessagesAtom = Atom.make<ReadonlyMap<string, readonly PendingBotMessage[]>>(
  new Map()
).pipe(Atom.keepAlive)

const noBots: readonly Bot[] = []
const noPending: readonly PendingBotMessage[] = []

export const botsAtom = Atom.readable((get) => {
  const listed = get(chromeAtom)?.bots ?? noBots
  const created = get(createdBotsAtom)
  const patches = get(botPatchesAtom)
  if (!created.size && !patches.size) return listed
  const known = new Set(listed.map((bot) => bot.id))
  return [...listed, ...[...created.values()].filter((bot) => !known.has(bot.id))].map((bot) => {
    const patch = patches.get(bot.id)
    return patch ? { ...bot, ...patch } : bot
  })
}).pipe(Atom.withEquality(Equal.equals))

export function useBots() {
  return useAtomValue(botsAtom)
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
        Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))
      ),
    forget
  )
  trackCreation(id, creation)
  return id
}

export const useCreateBot = () => useAction(createBot)

function markBotSeen(registry: Registry, botId: string) {
  registry.update(botPatchesAtom, (patches) =>
    new Map(patches).set(botId, { ...patches.get(botId), unread: false })
  )
  const clear = () => registry.update(botPatchesAtom, (patches) => without(patches, [botId]))
  run(
    registry,
    (connection) =>
      connection
        .request('bot.markSeen', { botId })
        .pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              settleWhen(registry, () => serverBot(registry, botId)?.unread === false, clear)
            )
          )
        ),
    clear
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
  return !!registry.get(threadAtom(botId))?.items.some((item) => item.id === messageId)
}

function sendToBot(registry: Registry, botId: string, text: string, replyTo?: Reply) {
  const message: PendingBotMessage = {
    id: crypto.randomUUID(),
    text,
    ...(replyTo && { replyTo }),
    sentAt: Date.now(),
  }
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
          ...(replyTo && { replyTo }),
        })
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (listed(registry, botId, message.id)) return drop()
            const stop = registry.subscribe(threadAtom(botId), () => {
              if (!listed(registry, botId, message.id)) return
              stop()
              drop()
            })
          })
        ),
        Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))
      ),
    drop
  )
  return message.id
}

export const useSendToBot = () => useAction(sendToBot)

const pendingAtom = Atom.family((botId: string) =>
  Atom.readable((get) => {
    const pending = get(pendingMessagesAtom).get(botId) ?? noPending
    if (!pending.length) return pending
    const items = get(threadAtom(botId))?.items
    if (!items) return pending
    const sent = new Set(items.map((item) => item.id))
    return pending.filter((message) => !sent.has(message.id))
  }).pipe(Atom.withEquality(Equal.equals))
)

// Jett's messages the bot's thread doesn't have yet, oldest first.
export function usePendingBotMessages(botId: string) {
  return useAtomValue(pendingAtom(botId))
}
