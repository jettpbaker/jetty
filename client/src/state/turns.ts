import type { Connection } from '@/net/connection'
import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'
import type { ThreadState } from '@jetty/shared/reducer'
import type { EffortLevel, PermissionMode } from '@jetty/shared/wire'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Effect, Exit } from 'effect'
import { Atom, AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext, useEffect, useMemo } from 'react'

import { connectionAtom } from './connection'
import { awaitCreation } from './mutations'

export type Loadout = {
  model?: string
  effort: EffortLevel
  permissionMode: PermissionMode
}

export type PendingPrompt = { text: string; priorCount: number }

const loadoutAtom = Atom.make<Loadout>({ effort: 'high', permissionMode: 'auto' }).pipe(
  Atom.keepAlive
)
const draftEpochAtom = Atom.make(0).pipe(Atom.keepAlive)
const pendingPromptsAtom = Atom.make<ReadonlyMap<string, readonly PendingPrompt[]>>(new Map()).pipe(
  Atom.keepAlive
)
const pendingTurnsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive)
const pendingDecisionsAtom = Atom.make<ReadonlyMap<string, ApprovalDecision>>(new Map()).pipe(
  Atom.keepAlive
)
const pendingAnswersAtom = Atom.make<ReadonlyMap<string, Readonly<Record<string, string>>>>(
  new Map()
).pipe(Atom.keepAlive)

function run<A, E>(
  registry: AtomRegistry.AtomRegistry,
  request: (connection: Connection) => Effect.Effect<A, E>,
  onExit: (exit: Exit.Exit<A, E>) => void
) {
  Effect.runFork(
    AtomRegistry.getResult(registry, connectionAtom).pipe(
      Effect.flatMap(request),
      Effect.onExit((exit) => Effect.sync(() => onExit(exit)))
    )
  )
}

function withoutPrompt(
  prompts: ReadonlyMap<string, readonly PendingPrompt[]>,
  threadId: string,
  text: string,
  priorCount: number
) {
  const next = new Map(prompts)
  const list = [...(next.get(threadId) ?? [])]
  const index = list.findLastIndex(
    (prompt) => prompt.text === text && prompt.priorCount === priorCount
  )
  if (index >= 0) list.splice(index, 1)
  if (list.length === 0) next.delete(threadId)
  else next.set(threadId, list)
  return next
}

function dropIds<V>(map: ReadonlyMap<string, V>, ids: readonly string[]) {
  let next: Map<string, V> | undefined
  for (const id of ids) {
    if (!map.has(id)) continue
    next ??= new Map(map)
    next.delete(id)
  }
  return next ?? map
}

function dropTurn(ids: ReadonlySet<string>, threadId: string) {
  if (!ids.has(threadId)) return ids
  const next = new Set(ids)
  next.delete(threadId)
  return next
}

function unmatchedPrompts(pending: readonly PendingPrompt[], items: readonly ThreadItem[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.kind !== 'user_message') continue
    counts.set(item.text, (counts.get(item.text) ?? 0) + 1)
  }
  const used = new Map<string, number>()
  const left: PendingPrompt[] = []
  for (const prompt of pending) {
    const taken = used.get(prompt.text) ?? 0
    const available = (counts.get(prompt.text) ?? 0) - prompt.priorCount
    if (taken < available) used.set(prompt.text, taken + 1)
    else left.push(prompt)
  }
  return left
}

function overlayItem(
  item: ThreadItem,
  decisions: ReadonlyMap<string, ApprovalDecision>,
  answers: ReadonlyMap<string, Readonly<Record<string, string>>>
): ThreadItem {
  if (item.kind === 'approval' && !item.decision) {
    const decision = decisions.get(item.id)
    if (decision) return { ...item, decision }
  }
  if (item.kind === 'question' && !item.answers && !item.skipped) {
    const picked = answers.get(item.id)
    if (picked) return { ...item, answers: picked }
  }
  return item
}

function pendingUserItems(pending: readonly PendingPrompt[]): ThreadItem[] {
  return pending.map((prompt, index) => ({
    kind: 'user_message' as const,
    id: `pending:${index}:${prompt.priorCount}:${prompt.text}`,
    turnId: 'pending',
    createdAt: 0,
    text: prompt.text,
    attachments: [],
  }))
}

function sendTurn(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  text: string,
  priorCount: number,
  loadout: Loadout
) {
  registry.update(pendingPromptsAtom, (prompts) => {
    const next = new Map(prompts)
    next.set(threadId, [...(next.get(threadId) ?? []), { text, priorCount }])
    return next
  })
  registry.update(pendingTurnsAtom, (ids) => new Set(ids).add(threadId))
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(
          connection.request('turn.start', {
            threadId,
            text,
            effort: loadout.effort,
            permissionMode: loadout.permissionMode,
            ...(loadout.model ? { model: loadout.model } : {}),
          })
        )
      ),
    (exit) => {
      if (Exit.isSuccess(exit)) return
      registry.update(pendingPromptsAtom, (prompts) =>
        withoutPrompt(prompts, threadId, text, priorCount)
      )
      registry.update(pendingTurnsAtom, (ids) => dropTurn(ids, threadId))
    }
  )
}

function interruptTurn(registry: AtomRegistry.AtomRegistry, threadId: string) {
  run(
    registry,
    (connection) => connection.request('turn.interrupt', { threadId }),
    () => {}
  )
}

function respondApproval(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  itemId: string,
  decision: ApprovalDecision
) {
  registry.update(pendingDecisionsAtom, (decisions) => new Map(decisions).set(itemId, decision))
  run(
    registry,
    (connection) => connection.request('approval.respond', { threadId, itemId, decision }),
    (exit) => {
      if (Exit.isSuccess(exit)) return
      registry.update(pendingDecisionsAtom, (decisions) => {
        if (decisions.get(itemId) !== decision) return decisions
        const next = new Map(decisions)
        next.delete(itemId)
        return next
      })
    }
  )
}

function respondQuestion(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  itemId: string,
  answers: Record<string, string>
) {
  registry.update(pendingAnswersAtom, (pending) => new Map(pending).set(itemId, answers))
  run(
    registry,
    (connection) => connection.request('question.respond', { threadId, itemId, answers }),
    (exit) => {
      if (Exit.isSuccess(exit)) return
      registry.update(pendingAnswersAtom, (pending) => {
        if (pending.get(itemId) !== answers) return pending
        const next = new Map(pending)
        next.delete(itemId)
        return next
      })
    }
  )
}

export function useLoadout() {
  const registry = useContext(RegistryContext)
  const loadout = useAtomValue(loadoutAtom)
  const setLoadout = useCallback((next: Loadout) => registry.set(loadoutAtom, next), [registry])
  return { loadout, setLoadout }
}

export function useDraftEpoch() {
  return useAtomValue(draftEpochAtom)
}

export function useBumpDraft() {
  const registry = useContext(RegistryContext)
  return useCallback(() => registry.update(draftEpochAtom, (epoch) => epoch + 1), [registry])
}

export function useSendTurn() {
  const registry = useContext(RegistryContext)
  const loadout = useAtomValue(loadoutAtom)
  return useCallback(
    (threadId: string, text: string, priorCount: number) =>
      sendTurn(registry, threadId, text, priorCount, loadout),
    [loadout, registry]
  )
}

export function useInterruptTurn() {
  const registry = useContext(RegistryContext)
  return useCallback((threadId: string) => interruptTurn(registry, threadId), [registry])
}

export function useRespondApproval() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, itemId: string, decision: ApprovalDecision) =>
      respondApproval(registry, threadId, itemId, decision),
    [registry]
  )
}

export function useRespondQuestion() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, itemId: string, answers: Record<string, string>) =>
      respondQuestion(registry, threadId, itemId, answers),
    [registry]
  )
}

export function useThreadOverlay(threadId: string, thread: ThreadState | undefined) {
  const registry = useContext(RegistryContext)
  const prompts = useAtomValue(pendingPromptsAtom)
  const decisions = useAtomValue(pendingDecisionsAtom)
  const answers = useAtomValue(pendingAnswersAtom)
  const turns = useAtomValue(pendingTurnsAtom)
  const items = useMemo(() => thread?.items ?? [], [thread])
  const pending = useMemo(
    () => unmatchedPrompts(prompts.get(threadId) ?? [], items),
    [items, prompts, threadId]
  )
  const overlaid = useMemo(
    () => items.map((item) => overlayItem(item, decisions, answers)),
    [answers, decisions, items]
  )
  const optimistic = turns.has(threadId)
  const promptCount = prompts.get(threadId)?.length ?? 0
  const status = thread?.status

  useEffect(() => {
    registry.update(pendingPromptsAtom, (map) => {
      const current = map.get(threadId) ?? []
      const left = unmatchedPrompts(current, items)
      if (left.length === current.length) return map
      const next = new Map(map)
      if (left.length === 0) next.delete(threadId)
      else next.set(threadId, left)
      return next
    })
  }, [items, registry, threadId])

  useEffect(() => {
    const settledDecisions: string[] = []
    for (const itemId of decisions.keys()) {
      const item = items.find((entry) => entry.id === itemId)
      if (item?.kind === 'approval' && item.decision) settledDecisions.push(itemId)
    }
    const settledAnswers: string[] = []
    for (const itemId of answers.keys()) {
      const item = items.find((entry) => entry.id === itemId)
      if (item?.kind === 'question' && (item.answers || item.skipped)) settledAnswers.push(itemId)
    }
    if (settledDecisions.length === 0 && settledAnswers.length === 0) return
    if (settledDecisions.length > 0)
      registry.update(pendingDecisionsAtom, (map) => dropIds(map, settledDecisions))
    if (settledAnswers.length > 0)
      registry.update(pendingAnswersAtom, (map) => dropIds(map, settledAnswers))
  }, [answers, decisions, items, registry])

  useEffect(() => {
    if (!optimistic) return
    const settled = status === 'idle' || status === 'error' || status === 'awaiting_approval'
    const live = status === 'running' || status === 'starting'
    if (live || (settled && promptCount === 0))
      registry.update(pendingTurnsAtom, (ids) => dropTurn(ids, threadId))
  }, [optimistic, promptCount, registry, status, threadId])

  return {
    items: [...overlaid, ...pendingUserItems(pending)],
    empty: overlaid.length === 0 && pending.length === 0,
    running: optimistic || status === 'running' || status === 'starting',
  }
}
