import { session } from '@/platform'
import { useAtomValue } from '@effect/atom-react'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { toast } from 'sonner'

import { useAction } from './connection'

// Unsaved edits to a file in a thread's checkout. They live here for the page's life, and a copy
// in session storage brings them back after a reload, so closing the file, switching threads or
// reloading never loses them. `base` is the file's text on disk that the edits started from.
export type FileDraft = { base: string; text: string }

const storageKey = (threadId: string, path: string) => `jetty.file-draft:${threadId}:${path}`

// null: known to have none.
const drafts = new Map<string, FileDraft | null>()

function stored(key: string): FileDraft | null {
  try {
    const draft: unknown = JSON.parse(session.get(key) ?? 'null')
    if (
      draft &&
      typeof (draft as FileDraft).base === 'string' &&
      typeof (draft as FileDraft).text === 'string'
    )
      return draft as FileDraft
  } catch {
    // A corrupt draft reads as none.
  }
  return null
}

function draftAt(key: string) {
  let draft = drafts.get(key)
  if (draft === undefined) {
    draft = stored(key)
    drafts.set(key, draft)
  }
  return draft ?? undefined
}

const dirtyAtom = Atom.family((key: string) =>
  Atom.make(draftAt(key) !== undefined).pipe(Atom.keepAlive)
)

export function readFileDraft(threadId: string, path: string): FileDraft | undefined {
  return draftAt(storageKey(threadId, path))
}

// Typing changes a draft many times a second, so its stored copy catches up a moment later.
const unstored = new Set<string>()
let storing: ReturnType<typeof setTimeout> | undefined
let warned = false

function storeDrafts() {
  clearTimeout(storing)
  for (const key of unstored) {
    const draft = drafts.get(key)
    if (!draft) session.remove(key)
    else if (!session.set(key, JSON.stringify(draft))) {
      // An older copy would come back after a reload as if it were the latest.
      session.remove(key)
      if (!warned)
        toast.error("Unsaved edits won't survive a reload", {
          description: "Browser storage is full. They're kept while this tab stays open.",
        })
      warned = true
    }
  }
  unstored.clear()
}

// A reload or a closing tab doesn't wait for the timer.
addEventListener('pagehide', storeDrafts)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') storeDrafts()
})

// No draft once the edits are saved or gone.
function writeFileDraft(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  path: string,
  draft: FileDraft | undefined
) {
  const key = storageKey(threadId, path)
  drafts.set(key, draft ?? null)
  registry.set(dirtyAtom(key), draft !== undefined)
  unstored.add(key)
  clearTimeout(storing)
  storing = setTimeout(storeDrafts, 300)
}

// A save put `saved` on disk, possibly after its editor closed. The draft goes, unless it was
// edited further meanwhile: then those edits stay, now over the saved text. The text is the
// draft's revision, since every save sends the draft's text as it was.
export function settleFileDraft(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  path: string,
  saved: string
) {
  const draft = readFileDraft(threadId, path)
  if (!draft) return
  writeFileDraft(
    registry,
    threadId,
    path,
    draft.text === saved ? undefined : { base: saved, text: draft.text }
  )
}

export const useWriteFileDraft = () => useAction(writeFileDraft)

export function useFileDirty(threadId: string, path: string) {
  return useAtomValue(dirtyAtom(storageKey(threadId, path)))
}
