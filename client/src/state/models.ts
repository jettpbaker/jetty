import type { AgentBehaviourKey, TitleModel } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'

import { run, useAction } from './connection'

const refreshingAtom = Atom.make(false).pipe(Atom.keepAlive)

function refreshModels(registry: AtomRegistry.AtomRegistry, force = false) {
  if (registry.get(refreshingAtom)) return
  registry.set(refreshingAtom, true)
  function finish() {
    registry.set(refreshingAtom, false)
  }
  run(
    registry,
    (connection) =>
      connection.request('models.refresh', { force }).pipe(Effect.ensuring(Effect.sync(finish))),
    finish
  )
}

export function useModelRefresh() {
  return { refreshing: useAtomValue(refreshingAtom), refresh: useAction(refreshModels) }
}

function setTitleModel(
  registry: AtomRegistry.AtomRegistry,
  choice: TitleModel,
  failed: () => void
) {
  run(registry, (connection) => connection.request('settings.setTitleModel', choice), failed)
}

export const useSetTitleModel = () => useAction(setTitleModel)

function setAgentBehaviour(
  registry: AtomRegistry.AtomRegistry,
  key: AgentBehaviourKey,
  enabled: boolean,
  failed: () => void
) {
  run(
    registry,
    (connection) => connection.request('settings.setAgentBehaviour', { key, enabled }),
    failed
  )
}

export const useSetAgentBehaviour = () => useAction(setAgentBehaviour)
