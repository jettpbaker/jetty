import type { IssueSnapshot } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { AsyncResult, Atom } from 'effect/reactivity'

import { connectionAtom } from './connection'

export type IssueRef = { repo: string; number: number }

function issueKey(ref: IssueRef) {
  return `${ref.repo}#${ref.number}`
}

function parseKey(key: string): IssueRef {
  const split = key.lastIndexOf('#')
  return { repo: key.slice(0, split), number: Number(key.slice(split + 1)) }
}

// Same lifetimes as a pull request chip: the snapshot stays while it's on screen, and the
// request itself is forgotten a minute after the chip goes, so the next visit asks again.
const cacheAtom = Atom.family((_key: string) =>
  Atom.make<IssueSnapshot | undefined>(undefined).pipe(Atom.setIdleTTL('30 minutes'))
)

const fetchedAtom = Atom.family((key: string) =>
  Atom.make((get) =>
    get.result(connectionAtom).pipe(
      Effect.flatMap((connection) => connection.request('issue.prefetch', parseKey(key))),
      Effect.tap((snapshot) => Effect.sync(() => get.set(cacheAtom(key), snapshot)))
    )
  ).pipe(Atom.setIdleTTL('1 minute'))
)

const summaryAtom = Atom.family((key: string) =>
  Atom.readable(
    (get) =>
      (get(cacheAtom(key)) ?? AsyncResult.getOrElse(get(fetchedAtom(key)), () => undefined))?.issue
  )
)

export function useIssueSummary(ref: IssueRef) {
  return useAtomValue(summaryAtom(issueKey(ref)))
}
