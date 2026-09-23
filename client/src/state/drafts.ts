import type { ComposerImage } from '@/hooks/use-image-attachments'

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

// The unsent composer state of one thread; the new-thread composer uses the key ''.
export type Draft = {
  text: string
  images: readonly ComposerImage[]
  // the queued message this draft rewrites
  editing?: string
  editingOwner?: string
  editingAt?: number
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
  editingOwner: Schema.optional(Schema.String),
  editingAt: Schema.optional(Schema.Number),
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

// Drafts survive a reload. Images live apart so typing never rewrites them, and only get what
// localStorage (~5M characters) can spare; the rest are dropped.
const textsKey = 'jetty.drafts'
const imagesKey = 'jetty.draft-images'
const imageBudget = 2_000_000
const editingLifetime = 3 * 60_000
const ownerKey = 'jetty.draft-owner'
const editingOwner = (() => {
  const saved = session.get(ownerKey)
  if (saved) return saved
  const id = crypto.randomUUID()
  session.set(ownerKey, id)
  return id
})()

const emptyDraft: Draft = { text: '', images: [] }

function readStored(key: string): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(storage.get(key) ?? '{}')
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {}
  } catch {
    return {}
  }
}

function writeStored(key: string, draftKey: string, value: unknown, stored = readStored(key)) {
  if (value === undefined) delete stored[draftKey]
  else stored[draftKey] = value
  if (Object.keys(stored).length) storage.set(key, JSON.stringify(stored))
  else storage.remove(key)
}

function loadDrafts() {
  const drafts = new Map<string, Draft>()
  for (const [key, stored] of Object.entries(readStored(textsKey)))
    if (isStoredDraft(stored)) {
      const draft = { ...stored, images: [] }
      if (draft.editing && (!draft.editingAt || Date.now() - draft.editingAt > editingLifetime)) {
        draft.editing = undefined
        draft.editingOwner = undefined
        draft.editingAt = undefined
        writeStored(textsKey, key, draft)
      }
      drafts.set(key, draft)
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

function persist(key: string, { images, ...draft }: Draft, previous: Draft) {
  const kept =
    draft.text !== '' ||
    draft.editing !== undefined ||
    Object.keys(draft.parked ?? {}).length > 0 ||
    Object.keys(draft.questions ?? {}).length > 0
  writeStored(textsKey, key, kept ? draft : undefined)
  const stale = storedImagesStale.delete(key)
  if (images === previous.images && !stale) return
  const stored = readStored(imagesKey)
  delete stored[key]
  let room = imageBudget - JSON.stringify(stored).length
  const saved = []
  for (const { name, mimeType, sizeBytes, dataUrl, width, height } of images) {
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

// A draft this tab has edited, or has on screen, is this tab's own; another tab's writes to it
// never replace it here. Every other draft follows the latest write from any tab.
const edited = new Set<string>()
const onScreen = new Map<string, number>()
// Own drafts whose stored images another tab has since rewritten.
const storedImagesStale = new Set<string>()

function change(registry: Registry, key: string, edit: (draft: Draft) => Draft) {
  edited.add(key)
  const previous = registry.get(draftsAtom).get(key) ?? emptyDraft
  const draft = edit(previous)
  registry.set(draftsAtom, new Map(registry.get(draftsAtom)).set(key, draft))
  persist(key, draft, previous)
}

// Each thread whose draft is rewriting a queued message, with that message's id.
export function editingDrafts(registry: Registry) {
  const editing: [threadId: string, messageId: string][] = []
  for (const [key, draft] of registry.get(draftsAtom))
    if (key && draft.editing && draft.editingOwner === editingOwner)
      editing.push([key, draft.editing])
  return editing
}

export function renewEditingDrafts(registry: Registry) {
  for (const [key] of editingDrafts(registry))
    change(registry, key, (draft) => ({ ...draft, editingAt: Date.now() }))
}

export function useSyncDrafts() {
  const registry = useContext(RegistryContext)
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key !== textsKey && event.key !== imagesKey && event.key !== null) return
      const drafts = loadDrafts()
      const current = registry.get(draftsAtom)
      for (const key of [...edited, ...onScreen.keys()]) {
        const own = current.get(key)
        if (own) drafts.set(key, own)
        else drafts.delete(key)
        if (event.key !== textsKey) storedImagesStale.add(key)
      }
      registry.set(draftsAtom, drafts)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [registry])
}

// Puts a message the server refused back in its composer, ahead of anything typed since.
export function restoreDraft(
  registry: Registry,
  key: string,
  restored: Pick<Draft, 'text' | 'images' | 'editing'>
) {
  change(registry, key, (draft) => ({
    ...draft,
    typedFor: undefined,
    text: [restored.text, draft.text].filter((text) => text.trim()).join('\n\n'),
    images: [...restored.images, ...draft.images],
    editing: draft.editing ?? restored.editing,
    editingOwner: draft.editing ? draft.editingOwner : editingOwner,
    editingAt: Date.now(),
  }))
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
  useEffect(() => {
    onScreen.set(key, (onScreen.get(key) ?? 0) + 1)
    return () => {
      const left = (onScreen.get(key) ?? 1) - 1
      if (left) onScreen.set(key, left)
      else onScreen.delete(key)
    }
  }, [key])
  const update = useCallback(
    (patch: Partial<Draft>) =>
      change(registry, key, (draft) => ({
        ...draft,
        ...patch,
        ...('editing' in patch
          ? {
              editingOwner: patch.editing ? editingOwner : undefined,
              editingAt: patch.editing ? Date.now() : undefined,
            }
          : draft.editingOwner === editingOwner && draft.editing
            ? { editingAt: Date.now() }
            : {}),
      })),
    [key, registry]
  )
  // the latest draft, for work that finishes after a render
  const read = useCallback(() => registry.get(draftAtom(key)), [key, registry])
  return { draft, update, read }
}
