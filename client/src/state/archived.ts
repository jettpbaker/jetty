import type { ResultOf } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import {
  prepareArchivedSearch,
  type ArchivedSearchDoc,
  type ArchivedSearchFields,
} from '@jetty/shared/search'
import { Effect } from 'effect'
import { AsyncResult, Atom } from 'effect/reactivity'
import { useEffect, useState } from 'react'

import { connectionAtom } from './connection'

type ArchivedHits = ResultOf<'thread.searchArchived'>['hits']

const archiveSearchAtom = Atom.family((query: string) =>
  Atom.make((get) =>
    query
      ? get.result(connectionAtom).pipe(
          Effect.flatMap((connection) => connection.request('thread.searchArchived', { query })),
          Effect.map((result) => result.hits)
        )
      : Effect.succeed([] as ArchivedHits)
  ).pipe(Atom.setIdleTTL('1 minute'))
)

// Long enough that a keystroke paints before the request leaves.
const SEARCH_PAUSE_MS = 200

// Message hits for the query the field has settled on. Metadata matching does not use this.
export function useArchivedMessageSearch(query: string) {
  const trimmed = query.trim()
  const [debounced, setDebounced] = useState(trimmed)
  useEffect(() => {
    if (!trimmed) {
      setDebounced('')
      return
    }
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [trimmed])
  const result = useAtomValue(archiveSearchAtom(debounced))
  const current = trimmed !== '' && trimmed === debounced
  const hits = current && AsyncResult.isSuccess(result) ? result.value : undefined
  const failed = current && AsyncResult.isFailure(result) && hits === undefined
  return {
    hits,
    settled: trimmed === '' || hits !== undefined || failed,
    failed,
  }
}

// Chrome pushes rewrite every thread. Tokenizing the visible fields again on each one would hitch the page.
const docCache = new Map<string, { fields: ArchivedSearchFields; doc: ArchivedSearchDoc }>()

export function archivedSearchDoc(id: string, fields: ArchivedSearchFields) {
  const hit = docCache.get(id)
  if (
    hit &&
    hit.fields.title === fields.title &&
    hit.fields.project === fields.project &&
    hit.fields.branch === fields.branch &&
    hit.fields.pr === fields.pr &&
    hit.fields.messages === fields.messages
  )
    return hit.doc
  const doc = prepareArchivedSearch(fields)
  docCache.set(id, { fields, doc })
  return doc
}

export function retainArchivedSearchDocs(ids: readonly string[]) {
  const live = new Set(ids)
  for (const id of docCache.keys()) {
    if (!live.has(id)) docCache.delete(id)
  }
}
