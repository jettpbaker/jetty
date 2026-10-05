import type { AgentBehaviourKey, TitleModel } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { AsyncResult, Atom, type AtomRegistry } from 'effect/reactivity'

import { liveAtom } from './chrome'
import { run, useAction } from './connection'
import { observeOptimistic } from './optimistic'

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
  settled: () => void
) {
  const pending = observeOptimistic(
    registry,
    liveAtom,
    (state) => {
      const server = AsyncResult.getOrElse(state, () => undefined)?.titleModel
      return (
        !!server &&
        choice.model?.provider === server.model?.provider &&
        choice.model?.id === server.model?.id &&
        (choice.effort ?? null) === (server.effort ?? null)
      )
    },
    settled
  )
  run(
    registry,
    (connection) =>
      connection
        .request('settings.setTitleModel', choice)
        .pipe(Effect.tap(() => Effect.sync(pending.accepted))),
    pending.failed
  )
}

export const useSetTitleModel = () => useAction(setTitleModel)

function setAgentBehaviour(
  registry: AtomRegistry.AtomRegistry,
  key: AgentBehaviourKey,
  enabled: boolean,
  settled: () => void
) {
  const pending = observeOptimistic(
    registry,
    liveAtom,
    (state) => AsyncResult.getOrElse(state, () => undefined)?.agentBehaviours?.[key] === enabled,
    settled
  )
  run(
    registry,
    (connection) =>
      connection
        .request('settings.setAgentBehaviour', { key, enabled })
        .pipe(Effect.tap(() => Effect.sync(pending.accepted))),
    pending.failed
  )
}

export const useSetAgentBehaviour = () => useAction(setAgentBehaviour)
