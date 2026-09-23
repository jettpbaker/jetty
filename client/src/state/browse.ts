import type { ResultOf } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { AsyncResult, Atom } from 'effect/unstable/reactivity'
import { useState } from 'react'

import { connectionAtom } from './connection'

type BrowseResult = ResultOf<'fs.browse'>

const browseAtom = Atom.family((partialPath: string) =>
  Atom.make((get) =>
    get
      .result(connectionAtom)
      .pipe(Effect.flatMap((connection) => connection.request('fs.browse', { partialPath })))
  ).pipe(Atom.setIdleTTL('30 seconds'))
)

// Holds the last listing while the next path loads, so typing never blanks the list.
export function useBrowse(partialPath: string) {
  const browsed = useAtomValue(browseAtom(partialPath))
  const [shown, setShown] = useState<BrowseResult>()
  const fresh = AsyncResult.isSuccess(browsed) ? browsed.value : undefined
  if (fresh && fresh !== shown) setShown(fresh)
  return fresh ?? shown
}
