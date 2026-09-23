import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'
import type { ThreadState } from '@jetty/shared/reducer'
import type { EffortLevel, ProviderId } from '@jetty/shared/wire'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext, useEffect, useMemo } from 'react'

import { accessModeAtom } from './access_mode'
import { run, useAction } from './connection'
import { awaitCreation, clearPatch, setPatch, without, withoutId } from './mutations'

type Registry = AtomRegistry.AtomRegistry

export type Loadout = {
  model?: string
  effort: EffortLevel
  provider: ProviderId
}

type PendingPrompt = { text: string; priorCount: number }
type Answers = Readonly<Record<string, string>>

const draftProvider: ProviderId = 'grok'

const loadoutAtom = Atom.make<Loadout>({
  effort: 'high',
  provider: draftProvider,
}).pipe(Atom.keepAlive)
const draftEpochAtom = Atom.make(0).pipe(Atom.keepAlive)
const pendingPromptsAtom = Atom.make<ReadonlyMap<string, readonly PendingPrompt[]>>(new Map()).pipe(
  Atom.keepAlive
)
const pendingTurnsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive)
const pendingDecisionsAtom = Atom.make<ReadonlyMap<string, ApprovalDecision>>(new Map()).pipe(
  Atom.keepAlive
)
const pendingAnswersAtom = Atom.make<ReadonlyMap<string, Answers>>(new Map()).pipe(Atom.keepAlive)

function withPrompts(
  prompts: ReadonlyMap<string, readonly PendingPrompt[]>,
  threadId: string,
  list: readonly PendingPrompt[]
) {
  if (list.length === 0) return without(prompts, [threadId])
  return new Map(prompts).set(threadId, list)
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
  answers: ReadonlyMap<string, Answers>
): ThreadItem {
  if (item.kind === 'approval' && !item.decision) {
    const decision = decisions.get(item.id)
    if (decision) return { ...item, decision }
  }
  if (item.kind === 'question' && !settled(item)) {
    const picked = answers.get(item.id)
    if (picked) return { ...item, answers: picked }
  }
  return item
}

function settled(item: ThreadItem) {
  if (item.kind === 'approval') return Boolean(item.decision)
  if (item.kind === 'question') return Boolean(item.answers || item.skipped)
  return false
}

function pendingUserItems(pending: readonly PendingPrompt[]): ThreadItem[] {
  return pending.map((prompt, index) => ({
    kind: 'user_message',
    id: `pending:${index}:${prompt.priorCount}:${prompt.text}`,
    turnId: 'pending',
    createdAt: 0,
    text: prompt.text,
    attachments: [],
  }))
}

function sendTurn(
  registry: Registry,
  threadId: string,
  text: string,
  priorCount: number,
  provider: ProviderId
) {
  const loadout = registry.get(loadoutAtom)
  registry.update(pendingPromptsAtom, (prompts) =>
    withPrompts(prompts, threadId, [...(prompts.get(threadId) ?? []), { text, priorCount }])
  )
  registry.update(pendingTurnsAtom, (ids) => new Set(ids).add(threadId))
  setPatch(registry, threadId, { provider })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(
          connection.request('turn.start', {
            threadId,
            text,
            provider,
            effort: loadout.effort,
            permissionMode: registry.get(accessModeAtom),
            ...(loadout.model ? { model: loadout.model } : {}),
          })
        )
      ),
    () => {
      clearPatch(registry, threadId, 'provider')
      registry.update(pendingPromptsAtom, (prompts) => {
        const list = [...(prompts.get(threadId) ?? [])]
        const index = list.findLastIndex(
          (prompt) => prompt.text === text && prompt.priorCount === priorCount
        )
        if (index >= 0) list.splice(index, 1)
        return withPrompts(prompts, threadId, list)
      })
      registry.update(pendingTurnsAtom, (ids) => withoutId(ids, threadId))
    }
  )
}

function interruptTurn(registry: Registry, threadId: string) {
  run(registry, (connection) => connection.request('turn.interrupt', { threadId }))
}

function respondApproval(
  registry: Registry,
  threadId: string,
  itemId: string,
  decision: ApprovalDecision
) {
  registry.update(pendingDecisionsAtom, (decisions) => new Map(decisions).set(itemId, decision))
  run(
    registry,
    (connection) => connection.request('approval.respond', { threadId, itemId, decision }),
    () =>
      registry.update(pendingDecisionsAtom, (decisions) =>
        decisions.get(itemId) === decision ? without(decisions, [itemId]) : decisions
      )
  )
}

function respondQuestion(
  registry: Registry,
  threadId: string,
  itemId: string,
  answers: Record<string, string>
) {
  registry.update(pendingAnswersAtom, (pending) => new Map(pending).set(itemId, answers))
  run(
    registry,
    (connection) => connection.request('question.respond', { threadId, itemId, answers }),
    () =>
      registry.update(pendingAnswersAtom, (pending) =>
        pending.get(itemId) === answers ? without(pending, [itemId]) : pending
      )
  )
}

function bumpDraft(registry: Registry) {
  registry.update(draftEpochAtom, (epoch) => epoch + 1)
  registry.update(loadoutAtom, (loadout) =>
    loadout.provider === draftProvider ? loadout : { ...loadout, provider: draftProvider }
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
  return useAction(bumpDraft)
}

export function useSendTurn() {
  return useAction(sendTurn)
}

export function useInterruptTurn() {
  return useAction(interruptTurn)
}

export function useRespondApproval() {
  return useAction(respondApproval)
}

export function useRespondQuestion() {
  return useAction(respondQuestion)
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
  const live = status === 'running' || status === 'starting'

  useEffect(() => {
    registry.update(pendingPromptsAtom, (map) => {
      const current = map.get(threadId) ?? []
      const left = unmatchedPrompts(current, items)
      return left.length === current.length ? map : withPrompts(map, threadId, left)
    })
  }, [items, registry, threadId])

  useEffect(() => {
    if (decisions.size === 0 && answers.size === 0) return
    const settledIds = items.filter(settled).map((item) => item.id)
    registry.update(pendingDecisionsAtom, (map) => without(map, settledIds))
    registry.update(pendingAnswersAtom, (map) => without(map, settledIds))
  }, [answers, decisions, items, registry])

  useEffect(() => {
    if (optimistic && (live || (status && promptCount === 0)))
      registry.update(pendingTurnsAtom, (ids) => withoutId(ids, threadId))
  }, [live, optimistic, promptCount, registry, status, threadId])

  return {
    items: [...overlaid, ...pendingUserItems(pending)],
    empty: overlaid.length === 0 && pending.length === 0,
    running: optimistic || live,
  }
}
