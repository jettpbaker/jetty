import type { ReadyImage } from '@/hooks/use-image-attachments'
import type { ApprovalDecision, Attachment, ThreadItem } from '@jetty/shared/items'
import type { ThreadState } from '@jetty/shared/reducer'
import type { ProviderModel, ThreadMeta } from '@jetty/shared/wire'

import { equipModel, sameLoadout, slotLoadout, type Loadout, type LoadoutSlot } from '@/lib/loadout'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext, useEffect, useMemo } from 'react'

import { accessModeAtom } from './access_mode'
import { modelsAtom, useChrome } from './chrome'
import { run, useAction } from './connection'
import { loadoutsAtom } from './loadouts'
import { awaitCreation, clearPatch, setPatch, without, withoutId } from './mutations'

type Registry = AtomRegistry.AtomRegistry

type PendingPrompt = { text: string; priorCount: number; images: readonly Attachment[] }
type Answers = Readonly<Record<string, string>>

const draftKey = ''

const loadoutOverridesAtom = Atom.make<ReadonlyMap<string, Loadout>>(new Map()).pipe(Atom.keepAlive)
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

function releasePrompts(prompts: readonly PendingPrompt[]) {
  for (const prompt of prompts) for (const image of prompt.images) URL.revokeObjectURL(image.id)
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
    attachments: prompt.images,
  }))
}

function sendTurn(
  registry: Registry,
  threadId: string,
  text: string,
  priorCount: number,
  loadout: Loadout | undefined,
  images: readonly ReadyImage[] = []
) {
  if (loadout)
    registry.update(loadoutOverridesAtom, (overrides) =>
      new Map(without(overrides, [draftKey])).set(threadId, loadout)
    )
  const prompt: PendingPrompt = {
    text,
    priorCount,
    images: images.map(({ url, name, mimeType, sizeBytes, width, height }) => ({
      id: url,
      name,
      mimeType,
      sizeBytes,
      width,
      height,
    })),
  }
  registry.update(pendingPromptsAtom, (prompts) =>
    withPrompts(prompts, threadId, [...(prompts.get(threadId) ?? []), prompt])
  )
  registry.update(pendingTurnsAtom, (ids) => new Set(ids).add(threadId))
  if (loadout) setPatch(registry, threadId, { provider: loadout.provider })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(
          connection.request('turn.start', {
            threadId,
            text,
            ...loadout,
            permissionMode: registry.get(accessModeAtom),
            ...(images.length > 0
              ? {
                  attachments: images.map(({ name, mimeType, dataUrl }) => ({
                    name,
                    mimeType,
                    dataUrl,
                  })),
                }
              : {}),
          })
        )
      ),
    () => {
      clearPatch(registry, threadId, 'provider')
      releasePrompts([prompt])
      registry.update(pendingPromptsAtom, (prompts) => {
        const list = (prompts.get(threadId) ?? []).filter((pending) => pending !== prompt)
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
  registry.update(loadoutOverridesAtom, (overrides) => without(overrides, [draftKey]))
}

function firstLoadout(slots: readonly LoadoutSlot[]) {
  for (const slot of slots) {
    const loadout = slotLoadout(slot)
    if (loadout) return loadout
  }
}

function savedLoadout(
  thread: ThreadMeta | undefined,
  slots: readonly LoadoutSlot[],
  catalog: readonly ProviderModel[]
): Loadout | undefined {
  const provider = thread?.provider
  if (!provider) return firstLoadout(slots)
  if (thread.model)
    return { provider, model: thread.model, effort: thread.effort, fast: thread.fast ?? false }
  const slot = firstLoadout(slots.filter((item) => item.provider === provider))
  if (slot) return slot
  const model = catalog.find((item) => item.provider === provider)
  return model && equipModel({ fast: false }, model)
}

export function useThreadLoadout(threadId: string | undefined) {
  const registry = useContext(RegistryContext)
  const key = threadId ?? draftKey
  const override = useAtomValue(loadoutOverridesAtom).get(key)
  const slots = useAtomValue(loadoutsAtom)
  const catalog = useAtomValue(modelsAtom)
  const thread = useChrome()?.threads.find((item) => item.id === threadId)
  const saved = useMemo(() => savedLoadout(thread, slots, catalog), [catalog, slots, thread])
  const settled = Boolean(override && saved && sameLoadout(override, saved))

  useEffect(() => {
    if (settled) registry.update(loadoutOverridesAtom, (overrides) => without(overrides, [key]))
  }, [key, registry, settled])

  const setLoadout = useCallback(
    (next: Loadout) =>
      registry.update(loadoutOverridesAtom, (overrides) => new Map(overrides).set(key, next)),
    [key, registry]
  )
  return { loadout: override ?? saved, lockedProvider: thread?.provider, setLoadout }
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
  const live = status === 'running' || status === 'starting' || status === 'awaiting_approval'

  useEffect(() => {
    const current = registry.get(pendingPromptsAtom).get(threadId) ?? []
    const left = unmatchedPrompts(current, items)
    if (left.length === current.length) return
    releasePrompts(current.filter((prompt) => !left.includes(prompt)))
    registry.update(pendingPromptsAtom, (map) => withPrompts(map, threadId, left))
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
