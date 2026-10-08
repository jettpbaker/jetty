import type { ComposerImage, ReadyImage } from '@/hooks/use-image-attachments'
import type { Loadout } from '@/lib/loadout'

import { session, storage } from '@/platform'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { EffortLevel } from '@jetty/shared/events'
import { Reply } from '@jetty/shared/items'
import { ProviderId, UploadAttachment } from '@jetty/shared/wire'
import { Equal, Schema } from 'effect'
import { AsyncResult, Atom, type AtomRegistry } from 'effect/reactivity'
import { useCallback, useContext, useEffect } from 'react'

import { botsAtom } from './bots'
import { createdThreadsAtom, liveAtom } from './chrome'
import { without } from './mutations'
import { threadAtom } from './threads'

type Registry = AtomRegistry.AtomRegistry

const QuestionProgress = Schema.Struct({
  step: Schema.Number,
  picks: Schema.Array(Schema.Array(Schema.String)),
  custom: Schema.Array(Schema.String),
})
export type QuestionProgress = typeof QuestionProgress.Type

// Where a new-thread draft will go. Each field is the user's pick; absent ones use the defaults.
export type DraftTarget = {
  projectId?: string
  environment?: 'local' | 'worktree'
  ref?: string
  loadout?: Loadout
}

// A message that has left the composer but that the server hasn't taken yet. A new one carries
// the id it will have in its thread, so a reload can tell whether the server took it after all.
type Sending = {
  text: string
  images: readonly ReadyImage[]
  quote?: Reply
  editing?: string
  target?: DraftTarget
  sent?: { threadId: string; messageId: string }
}

// The unsent composer state of one thread; the new-thread composer uses the key ''.
export type Draft = {
  text: string
  images: readonly ComposerImage[]
  // what the message quotes from an agent's reply, shown on the composer's tab
  quote?: Reply
  // the queued message this draft rewrites
  editing?: string
  sending?: readonly Sending[]
  // new messages a reload cut off before the server answered, back in the composer only if it
  // never got them
  unsure?: readonly Sending[]
  // the pending approval or question on show, and what was typed for the others
  pendingId?: string
  // the pending item the text was started for; absent, the text is a follow-up message
  typedFor?: string
  parked?: Readonly<Record<string, string>>
  questions?: Readonly<Record<string, QuestionProgress>>
  target?: DraftTarget
  // composer images too large to keep through a reload, named until the composer's images change
  lostImages?: readonly string[]
}

const StoredTarget = Schema.Struct({
  projectId: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.Literals(['local', 'worktree'])),
  ref: Schema.optional(Schema.String),
  loadout: Schema.optional(
    Schema.Struct({
      provider: ProviderId,
      model: Schema.String,
      effort: Schema.optional(EffortLevel),
      fast: Schema.Boolean,
    })
  ),
})
const StoredDraft = Schema.Struct({
  text: Schema.String,
  quote: Schema.optional(Reply),
  editing: Schema.optional(Schema.String),
  sending: Schema.optional(
    Schema.Array(
      Schema.Struct({
        text: Schema.String,
        quote: Schema.optional(Reply),
        editing: Schema.optional(Schema.String),
        target: Schema.optional(StoredTarget),
        sent: Schema.optional(Schema.Struct({ threadId: Schema.String, messageId: Schema.String })),
      })
    )
  ),
  pendingId: Schema.optional(Schema.String),
  typedFor: Schema.optional(Schema.String),
  parked: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  questions: Schema.optional(Schema.Record(Schema.String, QuestionProgress)),
  target: Schema.optional(StoredTarget),
})
const StoredImage = Schema.Struct({
  name: Schema.String,
  mimeType: UploadAttachment.fields.mimeType,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  // the unsure send it belongs to; absent, it's the composer's
  messageId: Schema.optional(Schema.String),
})
const LostImage = Schema.Struct({ name: Schema.String, lost: Schema.Literal(true) })
const isStoredDraft = Schema.is(StoredDraft)
const isStoredImage = Schema.is(StoredImage)
const isLostImage = Schema.is(LostImage)

// Each tab keeps its own drafts, and they survive its reloads. Images live apart so typing never
// rewrites them, and only get what sessionStorage (~5M characters) can spare; the composer's
// others come back as names, so it can say they're gone.
const textsKey = 'jetty.drafts'
const imagesKey = 'jetty.draft-images'
const imageBudget = 2_000_000

// Drafts used to be shared by every tab.
storage.remove(textsKey)
storage.remove(imagesKey)
session.remove('jetty.draft-owner')

const emptyDraft: Draft = { text: '', images: [] }

function readStored(key: string): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(session.get(key) ?? '{}')
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {}
  } catch {
    return {}
  }
}

function writeStored(key: string, draftKey: string, value: unknown, stored = readStored(key)) {
  if (value === undefined) delete stored[draftKey]
  else stored[draftKey] = value
  if (Object.keys(stored).length) session.set(key, JSON.stringify(stored))
  else session.remove(key)
}

function loadDrafts() {
  const drafts = new Map<string, Draft>()
  for (const [key, stored] of Object.entries(readStored(textsKey)))
    if (isStoredDraft(stored)) {
      // Sends still unconfirmed died with the page. An edit comes back to the composer to send
      // again; a new message waits until the server says whether it got it.
      const { sending = [], ...draft } = stored
      const back = sending.filter((entry) => !entry.sent)
      const unsure = sending.flatMap((entry) => (entry.sent ? [{ ...entry, images: [] }] : []))
      drafts.set(key, {
        ...draft,
        text: [...back.map((entry) => entry.text), draft.text]
          .filter((text) => text.trim())
          .join('\n\n'),
        quote: draft.quote ?? back.find((entry) => entry.quote)?.quote,
        editing: draft.editing ?? back.find((entry) => entry.editing)?.editing,
        target: draft.target ?? back.find((entry) => entry.target)?.target,
        images: [],
        ...(unsure.length > 0 && { unsure }),
      })
    }
  for (const [key, stored] of Object.entries(readStored(imagesKey))) {
    if (!Array.isArray(stored)) continue
    const draft = drafts.get(key) ?? emptyDraft
    // A restored image's data URL is its identity, so a picture attached twice comes back once.
    const images = new Map<string, ComposerImage>()
    const unsure = new Map((draft.unsure ?? []).map((entry) => [entry.sent?.messageId, entry]))
    const lost: string[] = []
    for (const image of stored) {
      if (isLostImage(image)) lost.push(image.name)
      if (!isStoredImage(image)) continue
      const { messageId, ...rest } = image
      const entry = unsure.get(messageId)
      const restored = { ...rest, url: rest.dataUrl }
      if (messageId && entry)
        unsure.set(messageId, { ...entry, images: [...entry.images, restored] })
      else images.set(image.dataUrl, restored)
    }
    drafts.set(key, {
      ...draft,
      images: [...images.values()],
      ...(draft.unsure && { unsure: [...unsure.values()] }),
      ...(lost.length > 0 && { lostImages: lost }),
    })
  }
  return drafts
}

function persist(key: string, current: Draft, previous: Draft) {
  const { images, sending: inFlight = [], unsure = [], lostImages = [], ...draft } = current
  const sending = [...unsure, ...inFlight]
  const kept =
    draft.text !== '' ||
    draft.quote !== undefined ||
    draft.editing !== undefined ||
    sending.length > 0 ||
    draft.target !== undefined ||
    Object.keys(draft.parked ?? {}).length > 0 ||
    Object.keys(draft.questions ?? {}).length > 0
  writeStored(
    textsKey,
    key,
    kept
      ? {
          ...draft,
          ...(sending.length > 0 && {
            sending: sending.map(({ text, quote, editing, target, sent }) => ({
              text,
              quote,
              editing,
              target,
              sent,
            })),
          }),
        }
      : undefined
  )
  if (
    images === previous.images &&
    current.sending === previous.sending &&
    current.unsure === previous.unsure
  )
    return
  const stored = readStored(imagesKey)
  delete stored[key]
  let room = imageBudget - JSON.stringify(stored).length
  const saved: unknown[] = lostImages.map((name) => ({ name, lost: true }))
  const owned = [
    ...images.map((image) => ({ image, messageId: undefined })),
    ...sending.flatMap((entry) =>
      entry.images.map((image) => ({ image, messageId: entry.sent?.messageId }))
    ),
  ]
  for (const {
    image: { name, mimeType, sizeBytes, dataUrl, width, height },
    messageId,
  } of owned) {
    if (!dataUrl) continue
    if (dataUrl.length > room) {
      if (!messageId) saved.push({ name, lost: true })
      continue
    }
    room -= dataUrl.length
    saved.push({ name, mimeType, sizeBytes, dataUrl, width, height, messageId })
  }
  writeStored(imagesKey, key, saved.length ? saved : undefined, stored)
}

const draftsAtom = Atom.make<ReadonlyMap<string, Draft>>(loadDrafts()).pipe(Atom.keepAlive)

const draftAtom = Atom.family((key: string) =>
  Atom.make((get) => get(draftsAtom).get(key) ?? emptyDraft)
)

const draftEditingAtom = Atom.family((key: string) =>
  Atom.make((get) => get(draftAtom(key)).editing)
)

function change(registry: Registry, key: string, edit: (draft: Draft) => Draft) {
  const previous = registry.get(draftsAtom).get(key) ?? emptyDraft
  const draft = edit(previous)
  registry.set(draftsAtom, new Map(registry.get(draftsAtom)).set(key, draft))
  persist(key, draft, previous)
}

// Each thread whose draft is rewriting a queued message, with that message's id.
export function editingDrafts(registry: Registry) {
  const editing: [threadId: string, messageId: string][] = []
  for (const [key, draft] of registry.get(draftsAtom))
    if (key && draft.editing) editing.push([key, draft.editing])
  return editing
}

// Puts a message the server refused back in its composer, ahead of anything typed since.
function restoreDraft(registry: Registry, key: string, restored: Sending) {
  change(registry, key, (draft) => ({
    ...draft,
    typedFor: undefined,
    text: [restored.text, draft.text].filter((text) => text.trim()).join('\n\n'),
    images: [...restored.images, ...draft.images],
    quote: draft.quote ?? restored.quote,
    editing: draft.editing ?? restored.editing,
    target: key ? draft.target : (draft.target ?? restored.target),
  }))
}

// What was typed for a request whose answer didn't go through: back in the composer, answering
// it again, unless something else is typed there; then it waits for the request to show again.
export function restoreAnswer(
  registry: Registry,
  key: string,
  itemId: string,
  text: string,
  progress?: QuestionProgress
) {
  change(registry, key, (draft) => {
    const questions = progress ? { ...draft.questions, [itemId]: progress } : draft.questions
    if (!draft.text.trim())
      return { ...draft, questions, text, typedFor: itemId, pendingId: itemId }
    if (!text.trim()) return { ...draft, questions }
    return { ...draft, questions, parked: { ...draft.parked, [itemId]: text } }
  })
}

// A fresh new thread starts from the defaults; one with something typed keeps its target.
export function resetDraftTarget(registry: Registry) {
  change(registry, '', (draft) =>
    draft.text.trim() || draft.images.length ? draft : { ...draft, target: undefined }
  )
}

// Keeps a message that left the composer in its draft until the server takes it, so a reload
// in the meantime brings it back. With no key it's only restored if the server refuses it.
// The draft's target leaves with the message.
export function stageSend(registry: Registry, key: string | undefined, sending: Sending) {
  const target = key === undefined ? undefined : registry.get(draftsAtom).get(key)?.target
  const message = target ? { ...sending, target } : sending
  if (key !== undefined)
    change(registry, key, (draft) => ({
      ...draft,
      target: undefined,
      sending: [...(draft.sending ?? []), message],
    }))
  function sent() {
    if (key !== undefined)
      change(registry, key, (draft) => ({
        ...draft,
        sending: draft.sending?.filter((entry) => entry !== message),
      }))
  }
  return {
    sent,
    failed(into: string) {
      sent()
      restoreDraft(registry, into, message)
    },
  }
}

type UnsureSend = { key: string; entry: Sending; known: boolean; queued: boolean }

// Each new message a reload cut off, and whether the server knows its thread or holds it queued.
// Equal while those hold, so a chrome push doesn't restart the watches.
const unsureSendsAtom = Atom.readable((get): readonly UnsureSend[] | undefined => {
  const chrome = AsyncResult.getOrElse(get(liveAtom), () => undefined)
  if (!chrome) return undefined
  const sends: UnsureSend[] = []
  for (const [key, draft] of get(draftsAtom))
    for (const entry of draft.unsure ?? []) {
      const { threadId, messageId } = entry.sent!
      const thread = chrome.threads.find((candidate) => candidate.id === threadId)
      const bot = chrome.bots.some((candidate) => candidate.id === threadId)
      const queued = thread?.pendingMessages?.some((message) => message.id === messageId) ?? false
      sends.push({ key, entry, known: thread !== undefined || bot, queued })
    }
  return sends
}).pipe(Atom.withEquality(sameSends))

function sameSends(a?: readonly UnsureSend[], b?: readonly UnsureSend[]) {
  return (
    a === b ||
    (a?.length === b?.length &&
      (a ?? []).every((send, index) => {
        const other = b![index]!
        return (
          send.key === other.key &&
          send.entry === other.entry &&
          send.known === other.known &&
          send.queued === other.queued
        )
      }))
  )
}

// A new message a reload cut off goes back to its composer unless the server has it: waiting in
// the thread's queue, or in the thread once that has loaded.
export function useSettleUnsureSends() {
  const registry = useContext(RegistryContext)
  const sends = useAtomValue(unsureSendsAtom)
  useEffect(() => {
    if (!sends) return
    const watches: (() => void)[] = []
    for (const { key, entry, known, queued } of sends) {
      const { threadId, messageId } = entry.sent!
      if (!known || queued) settleUnsure(registry, key, entry, !known)
      else
        watches.push(
          registry.subscribe(
            threadAtom(threadId),
            (state) => {
              if (state)
                settleUnsure(
                  registry,
                  key,
                  entry,
                  !state.items.some((item) => item.id === messageId)
                )
            },
            { immediate: true }
          )
        )
    }
    return () => {
      for (const stop of watches) stop()
    }
  }, [sends, registry])
}

function settleUnsure(registry: Registry, key: string, entry: Sending, restore: boolean) {
  if (!registry.get(draftsAtom).get(key)?.unsure?.includes(entry)) return
  change(registry, key, (draft) => ({
    ...draft,
    unsure: draft.unsure?.filter((candidate) => candidate !== entry),
  }))
  if (restore) restoreDraft(registry, key, entry)
}

// By value, so only a thread or draft coming or going runs the cleanup below.
const serverThreadIdsAtom = Atom.readable((get) => {
  const chrome = AsyncResult.getOrElse(get(liveAtom), () => undefined)
  return (
    chrome &&
    new Set([...chrome.threads.map((thread) => thread.id), ...get(botsAtom).map((bot) => bot.id)])
  )
}).pipe(Atom.withEquality(Equal.equals))
const draftKeysAtom = Atom.readable((get) => new Set(get(draftsAtom).keys())).pipe(
  Atom.withEquality(Equal.equals)
)

// A thread gone from the server takes its draft with it. One hidden in an undo window (its own
// delete or its project's) is still on the server, so it keeps its draft until the delete commits.
export function useForgetDeletedDrafts() {
  const registry = useContext(RegistryContext)
  const threads = useAtomValue(serverThreadIdsAtom)
  const created = useAtomValue(createdThreadsAtom)
  const keys = useAtomValue(draftKeysAtom)
  useEffect(() => {
    if (!threads) return
    const gone = [...keys].filter((key) => key && !threads.has(key) && !created.has(key))
    if (!gone.length) return
    registry.update(draftsAtom, (drafts) => without(drafts, gone))
    for (const key of gone) {
      writeStored(textsKey, key, undefined)
      writeStored(imagesKey, key, undefined)
    }
  }, [threads, created, keys, registry])
}

export function useDraft(key: string) {
  const registry = useContext(RegistryContext)
  const draft = useAtomValue(draftAtom(key))
  const update = useCallback(
    (patch: Partial<Draft>) => change(registry, key, (draft) => ({ ...draft, ...patch })),
    [key, registry]
  )
  // the latest draft, for work that finishes after a render
  const read = useCallback(() => registry.get(draftAtom(key)), [key, registry])
  return { draft, update, read }
}

// The queued message a thread's draft rewrites, without re-rendering on each keystroke.
export function useDraftEditing(key: string) {
  return useAtomValue(draftEditingAtom(key))
}
