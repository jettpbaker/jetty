import type { ComposerImage, ReadyImage } from '@/hooks/use-image-attachments'

import { session, storage } from '@/platform'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { UploadAttachment } from '@jetty/shared/wire'
import { Schema } from 'effect'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext, useEffect } from 'react'

import { chromeAtom } from './chrome'
import { deletedThreadsAtom, without } from './mutations'

type Registry = AtomRegistry.AtomRegistry

const QuestionProgress = Schema.Struct({
  step: Schema.Number,
  picks: Schema.Array(Schema.Array(Schema.String)),
  custom: Schema.Array(Schema.String),
})
export type QuestionProgress = typeof QuestionProgress.Type

// A message that has left the composer but that the server hasn't taken yet.
type Sending = { text: string; images: readonly ReadyImage[]; editing?: string }

// The unsent composer state of one thread; the new-thread composer uses the key ''.
export type Draft = {
  text: string
  images: readonly ComposerImage[]
  // the queued message this draft rewrites
  editing?: string
  sending?: readonly Sending[]
  // the pending approval or question on show, and what was typed for the others
  pendingId?: string
  // the pending item the text was started for; absent, the text is a follow-up message
  typedFor?: string
  parked?: Readonly<Record<string, string>>
  questions?: Readonly<Record<string, QuestionProgress>>
}

const StoredDraft = Schema.Struct({
  text: Schema.String,
  editing: Schema.optional(Schema.String),
  sending: Schema.optional(
    Schema.Array(Schema.Struct({ text: Schema.String, editing: Schema.optional(Schema.String) }))
  ),
  pendingId: Schema.optional(Schema.String),
  typedFor: Schema.optional(Schema.String),
  parked: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  questions: Schema.optional(Schema.Record(Schema.String, QuestionProgress)),
})
const StoredImage = Schema.Struct({
  name: Schema.String,
  mimeType: UploadAttachment.fields.mimeType,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
})
const isStoredDraft = Schema.is(StoredDraft)
const isStoredImage = Schema.is(StoredImage)

// Each tab keeps its own drafts, and they survive its reloads. Images live apart so typing never
// rewrites them, and only get what sessionStorage (~5M characters) can spare; the rest are dropped.
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
      // Sends still unconfirmed died with the page; they come back to the composer to send again.
      const { sending = [], ...draft } = stored
      drafts.set(key, {
        ...draft,
        text: [...sending.map((sent) => sent.text), draft.text]
          .filter((text) => text.trim())
          .join('\n\n'),
        editing: draft.editing ?? sending.find((sent) => sent.editing)?.editing,
        images: [],
      })
    }
  for (const [key, stored] of Object.entries(readStored(imagesKey))) {
    if (!Array.isArray(stored)) continue
    // A restored image's data URL is its identity, so a picture attached twice comes back once.
    const images = new Map<string, ComposerImage>()
    for (const image of stored)
      if (isStoredImage(image)) images.set(image.dataUrl, { ...image, url: image.dataUrl })
    if (images.size)
      drafts.set(key, { ...(drafts.get(key) ?? emptyDraft), images: [...images.values()] })
  }
  return drafts
}

function persist(key: string, current: Draft, previous: Draft) {
  const { images, sending = [], ...draft } = current
  const kept =
    draft.text !== '' ||
    draft.editing !== undefined ||
    sending.length > 0 ||
    Object.keys(draft.parked ?? {}).length > 0 ||
    Object.keys(draft.questions ?? {}).length > 0
  writeStored(
    textsKey,
    key,
    kept
      ? {
          ...draft,
          ...(sending.length > 0 && {
            sending: sending.map(({ text, editing }) => ({ text, editing })),
          }),
        }
      : undefined
  )
  if (images === previous.images && current.sending === previous.sending) return
  const stored = readStored(imagesKey)
  delete stored[key]
  let room = imageBudget - JSON.stringify(stored).length
  const saved = []
  for (const { name, mimeType, sizeBytes, dataUrl, width, height } of [
    ...images,
    ...sending.flatMap((sent) => sent.images),
  ]) {
    if (!dataUrl || dataUrl.length > room) continue
    room -= dataUrl.length
    saved.push({ name, mimeType, sizeBytes, dataUrl, width, height })
  }
  writeStored(imagesKey, key, saved.length ? saved : undefined, stored)
}

const draftsAtom = Atom.make<ReadonlyMap<string, Draft>>(loadDrafts()).pipe(Atom.keepAlive)

const draftAtom = Atom.family((key: string) =>
  Atom.make((get) => get(draftsAtom).get(key) ?? emptyDraft)
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
    editing: draft.editing ?? restored.editing,
  }))
}

// Keeps a message that left the composer in its draft until the server takes it, so a reload
// in the meantime brings it back. With no key it's only restored if the server refuses it.
export function stageSend(registry: Registry, key: string | undefined, message: Sending) {
  if (key !== undefined)
    change(registry, key, (draft) => ({ ...draft, sending: [...(draft.sending ?? []), message] }))
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

// A thread gone from the server takes its draft with it; one still in its undo window keeps it.
export function useForgetDeletedDrafts() {
  const registry = useContext(RegistryContext)
  const chrome = useAtomValue(chromeAtom)
  const deleted = useAtomValue(deletedThreadsAtom)
  useEffect(() => {
    if (!chrome) return
    const threads = new Set(chrome.threads.map((thread) => thread.id))
    const gone = [...registry.get(draftsAtom).keys()].filter(
      (key) => key && !threads.has(key) && !deleted.has(key)
    )
    if (!gone.length) return
    registry.update(draftsAtom, (drafts) => without(drafts, gone))
    for (const key of gone) {
      writeStored(textsKey, key, undefined)
      writeStored(imagesKey, key, undefined)
    }
  }, [chrome, deleted, registry])
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
