import type { ProviderId, Skill } from '@jetty/shared/wire'

import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { AsyncResult, Atom } from 'effect/reactivity'

import { connectionAtom } from './connection'

const noSkills: readonly Skill[] = []

const skillsAtom = Atom.family((key: string) =>
  Atom.make((get) =>
    get.result(connectionAtom).pipe(
      Effect.flatMap((connection) => connection.request('skills.list', JSON.parse(key))),
      Effect.map((result) => result.skills)
    )
  ).pipe(Atom.setIdleTTL('10 minutes'))
)

// Loads with the composer so the / menu opens on a list already in hand.
export function useSkills(
  projectId: string | undefined,
  provider: ProviderId | undefined,
  threadId?: string
) {
  const atom = skillsAtom(JSON.stringify({ projectId, provider, threadId }))
  const skills = AsyncResult.getOrElse(useAtomValue(atom), () => noSkills)
  return { skills, refresh: useAtomRefresh(atom) }
}
