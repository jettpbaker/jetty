import { session } from '@/platform'
import { useAtomValue } from '@effect/atom-react'
import { Atom, type AtomRegistry } from 'effect/reactivity'

import { useAction } from './connection'

// Unsaved edits to a file in a thread's checkout, kept for the browser tab's life, so closing the
// file, switching threads or reloading never loses them. `base` is the file's text on disk that
// the edits started from.
export type FileDraft = { base: string; text: string }

const storageKey = (threadId: string, path: string) => `jetty.file-draft:${threadId}:${path}`

const dirtyAtom = Atom.family((key: string) =>
  Atom.make(session.get(key) !== undefined).pipe(Atom.keepAlive)
)

export function readFileDraft(threadId: string, path: string): FileDraft | undefined {
  try {
    const draft: unknown = JSON.parse(session.get(storageKey(threadId, path)) ?? 'null')
    if (
      draft &&
      typeof (draft as FileDraft).base === 'string' &&
      typeof (draft as FileDraft).text === 'string'
    )
      return draft as FileDraft
  } catch {
    // A corrupt draft reads as none.
  }
  return undefined
}

// No draft once the edits are saved or gone.
function writeFileDraft(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  path: string,
  draft: FileDraft | undefined
) {
  const key = storageKey(threadId, path)
  if (draft) session.set(key, JSON.stringify(draft))
  else session.remove(key)
  registry.set(dirtyAtom(key), draft !== undefined)
}

export const useWriteFileDraft = () => useAction(writeFileDraft)

export function useFileDirty(threadId: string, path: string) {
  return useAtomValue(dirtyAtom(storageKey(threadId, path)))
}
