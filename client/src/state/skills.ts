import type { Skill } from '@jetty/shared/wire'

import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { AsyncResult, Atom } from 'effect/reactivity'

import { connectionAtom } from './connection'

const noSkills: readonly Skill[] = []

// Keyed by project id; '' lists only the user's own skills.
const skillsAtom = Atom.family((projectId: string) =>
  Atom.make((get) =>
    get.result(connectionAtom).pipe(
      Effect.flatMap((connection) =>
        connection.request('skills.list', projectId ? { projectId } : {})
      ),
      Effect.map((result) => result.skills)
    )
  ).pipe(Atom.setIdleTTL('10 minutes'))
)

// Loads with the composer so the / menu opens on a list already in hand.
export function useSkills(projectId: string | undefined) {
  const atom = skillsAtom(projectId ?? '')
  const skills = AsyncResult.getOrElse(useAtomValue(atom), () => noSkills)
  return { skills, refresh: useAtomRefresh(atom) }
}
