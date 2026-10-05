import type { ReadyImage } from '@/hooks/use-image-attachments'
import type { ApprovalDecision, Attachment, ThreadItem } from '@jetty/shared/items'
import type { ThreadState } from '@jetty/shared/reducer'
import type { ProviderModel, ThreadMeta } from '@jetty/shared/wire'

import { revokeBlobUrl } from '@/lib/blob_urls'
import {
  equipModel,
  findModel,
  sameLoadoutIn,
  slotLoadout,
  type Loadout,
  type LoadoutSlot,
} from '@/lib/loadout'
import { resendOnDrop } from '@/net/connection'
import { perf } from '@/perf'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { heldByRestarts } from '@jetty/shared/items'
import { deliversQueue, newId } from '@jetty/shared/wire'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useCallback, useContext, useEffect, useMemo } from 'react'
import { toast } from 'sonner'

import { accessModeAtom } from './access_mode'
import { chromeAtom, modelsAtom, useChrome } from './chrome'
import { run, useAction } from './connection'
import {
  resetDraftTarget,
  restoreAnswer,
  stageSend,
  useDraft,
  type QuestionProgress,
} from './drafts'
import { enabledModelsAtom, usableLoadoutsAtom } from './loadouts'
import {
  awaitCreation,
  clearPatch,
  setPatch,
  settlePatch,
  unarchiveFirst,
  without,
  withoutId,
} from './mutations'
import { awaitsInput } from './thread_tab'

type Registry = AtomRegistry.AtomRegistry

// Its id becomes the message's id on the server, in the queue and in the thread alike.
export type PendingPrompt = {
  id: string
  text: string
  images: readonly Attachment[]
  sentAt: number
}
type Resolution = Readonly<Record<string, unknown>>

const loadoutOverridesAtom = Atom.make<ReadonlyMap<string, Loadout>>(new Map()).pipe(Atom.keepAlive)
const draftEpochAtom = Atom.make(0).pipe(Atom.keepAlive)
const pendingPromptsAtom = Atom.make<ReadonlyMap<string, readonly PendingPrompt[]>>(new Map()).pipe(
  Atom.keepAlive
)
const pendingTurnsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive)
// Approval and question answers, shown as settled until the server's own patch arrives.
const pendingResolutionsAtom = Atom.make<ReadonlyMap<string, Resolution>>(new Map()).pipe(
  Atom.keepAlive
)
// Workflows shown as stopped until the server settles them.
const stoppingWorkflowsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive)
// Threads the crash-loop guard held, shown as resumed and working until their turn starts.
const continuingAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive)

function withPrompts(
  prompts: ReadonlyMap<string, readonly PendingPrompt[]>,
  threadId: string,
  list: readonly PendingPrompt[]
) {
  if (list.length === 0) return without(prompts, [threadId])
  return new Map(prompts).set(threadId, list)
}

function threadMeta(registry: Registry, threadId: string) {
  return registry.get(chromeAtom)?.threads.find((thread) => thread.id === threadId)
}

function releasePrompts(prompts: readonly PendingPrompt[]) {
  for (const prompt of prompts) for (const image of prompt.images) revokeBlobUrl(image.id)
}

function unmatchedPrompts(pending: readonly PendingPrompt[], items: readonly ThreadItem[]) {
  if (pending.length === 0) return pending
  const sent = new Set(items.map((item) => item.id))
  return pending.filter((prompt) => !sent.has(prompt.id))
}

function overlayItem(
  item: ThreadItem,
  resolutions: ReadonlyMap<string, Resolution>,
  stopping: ReadonlySet<string>
): ThreadItem {
  if (item.kind === 'workflow' && item.status === 'running' && stopping.has(item.id))
    return { ...item, status: 'stopped', stopReason: 'you' }
  const resolution = awaitsInput(item) && resolutions.get(item.id)
  return resolution ? ({ ...item, ...resolution } as ThreadItem) : item
}

// A refused answer brings the request back with what was typed for it.
function resolve(
  registry: Registry,
  threadId: string,
  itemId: string,
  resolution: Resolution,
  request: Parameters<typeof run>[1],
  typed: { text?: string; progress?: QuestionProgress },
  problem: string
) {
  registry.update(pendingResolutionsAtom, (map) => new Map(map).set(itemId, resolution))
  run(registry, request, () => {
    registry.update(pendingResolutionsAtom, (map) =>
      map.get(itemId) === resolution ? without(map, [itemId]) : map
    )
    restoreAnswer(registry, threadId, itemId, typed.text ?? '', typed.progress)
    toast.error(problem)
  })
}

// The turn a message shown as sent belongs to until the server's copy arrives.
export const pendingTurnId = 'pending'

function pendingUserItems(pending: readonly PendingPrompt[]): ThreadItem[] {
  return pending.map((prompt) => ({
    kind: 'user_message',
    id: prompt.id,
    turnId: pendingTurnId,
    createdAt: prompt.sentAt,
    text: prompt.text,
    attachments: prompt.images,
  }))
}

// Shows the message as sent, and the thread as working, until the server's copy of it arrives;
// the returned settle takes both back.
export function showSent(registry: Registry, threadId: string, prompt: PendingPrompt) {
  registry.update(pendingPromptsAtom, (prompts) =>
    withPrompts(prompts, threadId, [...(prompts.get(threadId) ?? []), prompt])
  )
  registry.update(pendingTurnsAtom, (ids) => new Set(ids).add(threadId))
  return function settle() {
    registry.update(pendingPromptsAtom, (prompts) => {
      const list = (prompts.get(threadId) ?? []).filter((pending) => pending !== prompt)
      return withPrompts(prompts, threadId, list)
    })
    registry.update(pendingTurnsAtom, (ids) => withoutId(ids, threadId))
  }
}

function sendTurn(
  registry: Registry,
  threadId: string,
  text: string,
  loadout: Loadout | undefined,
  images: readonly ReadyImage[] = [],
  fromDraft?: string,
  onFailure?: () => void
) {
  const journey = perf.start('turn.send', { threadId })
  const id = newId()
  const staged = stageSend(registry, fromDraft, {
    text,
    images,
    sent: { threadId, messageId: id },
  })
  if (loadout)
    registry.update(loadoutOverridesAtom, (overrides) => new Map(overrides).set(threadId, loadout))
  const prompt: PendingPrompt = {
    id,
    text,
    sentAt: Date.now(),
    images: images.map(({ url, name, mimeType, sizeBytes, width, height }) => ({
      id: url,
      name,
      mimeType,
      sizeBytes,
      width,
      height,
    })),
  }
  const settle = showSent(registry, threadId, prompt)
  if (loadout) setPatch(registry, threadId, { provider: loadout.provider })
  perf.mark(journey, 'local')
  const unarchive = unarchiveFirst(registry, threadId, threadMeta(registry, threadId)?.archived)
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(unarchive(connection)),
        Effect.andThen(
          resendOnDrop(
            connection.request('turn.start', {
              threadId,
              messageId: prompt.id,
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
        Effect.tap(({ turnId }) =>
          Effect.sync(() => {
            if (loadout) settlePatch(registry, threadId, 'provider', loadout.provider)
            staged.sent()
            // No turn started: the server kept the message in the thread's paused queue.
            if (!turnId) {
              settle()
              releasePrompts([prompt])
            }
          })
        )
      ),
    () => {
      clearPatch(registry, threadId, 'provider')
      settle()
      // A thread that failed to create is gone; its message goes back to the new-thread composer.
      staged.failed(threadMeta(registry, threadId) ? threadId : '')
      onFailure?.()
      toast.error("Couldn't send message")
    }
  )
}

function continueThread(registry: Registry, threadId: string) {
  if (registry.get(continuingAtom).has(threadId)) return
  registry.update(continuingAtom, (ids) => new Set(ids).add(threadId))
  const unarchive = unarchiveFirst(registry, threadId, threadMeta(registry, threadId)?.archived)
  run(
    registry,
    (connection) =>
      unarchive(connection).pipe(
        Effect.andThen(connection.request('thread.continue', { threadId }))
      ),
    () => {
      registry.update(continuingAtom, (ids) => withoutId(ids, threadId))
      toast.error("Couldn't resume thread")
    }
  )
}

function interruptTurn(registry: Registry, threadId: string) {
  run(registry, (connection) => connection.request('turn.interrupt', { threadId }))
}

function stopWorkflow(registry: Registry, threadId: string, taskId: string) {
  registry.update(stoppingWorkflowsAtom, (ids) => new Set(ids).add(taskId))
  run(
    registry,
    (connection) => connection.request('workflow.stop', { threadId, taskId }),
    () => registry.update(stoppingWorkflowsAtom, (ids) => withoutId(ids, taskId))
  )
}

function respondApproval(
  registry: Registry,
  threadId: string,
  itemId: string,
  decision: ApprovalDecision,
  note?: string
) {
  const message = note?.trim() || undefined
  resolve(
    registry,
    threadId,
    itemId,
    { decision, ...(decision === 'deny' && message ? { deniedReason: message } : {}) },
    (connection) =>
      connection.request('approval.respond', {
        threadId,
        itemId,
        decision,
        message,
      }),
    { text: message },
    "Couldn't send your answer"
  )
}

function respondQuestion(
  registry: Registry,
  threadId: string,
  itemId: string,
  answers: Record<string, string>,
  progress: QuestionProgress
) {
  resolve(
    registry,
    threadId,
    itemId,
    { answers },
    (connection) => connection.request('question.respond', { threadId, itemId, answers }),
    { text: progress.custom[progress.step], progress },
    "Couldn't send your answer"
  )
}

function dismissQuestion(
  registry: Registry,
  threadId: string,
  itemId: string,
  progress: QuestionProgress
) {
  resolve(
    registry,
    threadId,
    itemId,
    { dismissed: true },
    (connection) => connection.request('question.dismiss', { threadId, itemId }),
    { text: progress.custom[progress.step], progress },
    "Couldn't dismiss the question"
  )
}

function bumpDraft(registry: Registry) {
  registry.update(draftEpochAtom, (epoch) => epoch + 1)
  resetDraftTarget(registry)
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

// A thread's pick lives here until the server saves it; the new-thread draft keeps its own.
export function useThreadLoadout(threadId: string | undefined) {
  const registry = useContext(RegistryContext)
  const overrides = useAtomValue(loadoutOverridesAtom)
  const { draft, update, read } = useDraft('')
  const enabled = useAtomValue(enabledModelsAtom)
  const drafted = draft.target?.loadout
  const override = threadId
    ? overrides.get(threadId)
    : drafted && findModel(enabled, drafted)
      ? drafted
      : undefined
  const slots = useAtomValue(usableLoadoutsAtom)
  const catalog = useAtomValue(modelsAtom)
  const thread = useChrome()?.threads.find((item) => item.id === threadId)
  const saved = useMemo(() => savedLoadout(thread, slots, catalog), [catalog, slots, thread])
  const settled = Boolean(override && saved && sameLoadoutIn(catalog, override, saved))

  const setLoadout = useCallback(
    (next: Loadout | undefined) => {
      if (!threadId) return update({ target: { ...read().target, loadout: next } })
      registry.update(loadoutOverridesAtom, (map) =>
        next ? new Map(map).set(threadId, next) : without(map, [threadId])
      )
    },
    [read, registry, threadId, update]
  )

  useEffect(() => {
    if (settled) setLoadout(undefined)
  }, [setLoadout, settled])

  return { loadout: override ?? saved, lockedProvider: thread?.provider, setLoadout }
}

// What the user just sent, shown as sent while the server holds it in the queue for a moment.
export function useSendingIds(threadId: string | undefined) {
  const prompts = useAtomValue(pendingPromptsAtom)
  return useMemo(
    () => (prompts.get(threadId ?? '') ?? []).map((prompt) => prompt.id),
    [prompts, threadId]
  )
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

export function useContinueThread() {
  return useAction(continueThread)
}

export function useContinuing(threadId: string) {
  return useAtomValue(continuingAtom).has(threadId)
}

function compactThread(registry: Registry, threadId: string) {
  return run(
    registry,
    (connection) => connection.request('thread.compact', { threadId }),
    () => toast.error("Couldn't compact conversation")
  )
}

export function useCompactThread() {
  return useAction(compactThread)
}

function stopBackgroundTasks(registry: Registry, threadId: string, taskId?: string) {
  return run(
    registry,
    (connection) => connection.request('background.stop', { threadId, taskId }),
    () => toast.error("Couldn't stop background tasks")
  )
}

export function useStopBackgroundTasks() {
  return useAction(stopBackgroundTasks)
}

export function useStopWorkflow() {
  return useAction(stopWorkflow)
}

export function useRespondApproval() {
  return useAction(respondApproval)
}

export function useRespondQuestion() {
  return useAction(respondQuestion)
}

export function useDismissQuestion() {
  return useAction(dismissQuestion)
}

export function useThreadOverlay(threadId: string, thread: ThreadState | undefined) {
  const registry = useContext(RegistryContext)
  const prompts = useAtomValue(pendingPromptsAtom)
  const resolutions = useAtomValue(pendingResolutionsAtom)
  const turns = useAtomValue(pendingTurnsAtom)
  const stopping = useAtomValue(stoppingWorkflowsAtom)
  const continuing = useAtomValue(continuingAtom).has(threadId)
  const items = useMemo(() => thread?.items ?? [], [thread])
  const pending = useMemo(
    () => unmatchedPrompts(prompts.get(threadId) ?? [], items),
    [items, prompts, threadId]
  )
  const overlaid = useMemo(
    () => items.map((item) => overlayItem(item, resolutions, stopping)),
    [items, resolutions, stopping]
  )
  const optimistic = turns.has(threadId)
  const promptCount = prompts.get(threadId)?.length ?? 0
  const status = thread?.status
  // Running workflows and subagents keep the thread running between turns; only a turn makes the
  // composer queue.
  const live =
    (status === 'running' && Boolean(thread?.activeTurnId)) ||
    status === 'starting' ||
    status === 'awaiting_approval'
  // A queue about to send its next message keeps the composer busy into that message's turn.
  const meta = useChrome()?.threads.find((entry) => entry.id === threadId)
  const delivering = meta !== undefined && deliversQueue(meta)

  useEffect(() => {
    const current = registry.get(pendingPromptsAtom).get(threadId) ?? []
    const left = unmatchedPrompts(current, items)
    if (left.length === current.length) return
    releasePrompts(current.filter((prompt) => !left.includes(prompt)))
    registry.update(pendingPromptsAtom, (map) => withPrompts(map, threadId, left))
  }, [items, registry, threadId])

  useEffect(() => {
    if (resolutions.size === 0) return
    const settledIds = items
      .filter(
        (item) => (item.kind === 'approval' || item.kind === 'question') && !awaitsInput(item)
      )
      .map((item) => item.id)
    registry.update(pendingResolutionsAtom, (map) => without(map, settledIds))
  }, [items, registry, resolutions])

  useEffect(() => {
    const settled = items
      .filter((item) => item.kind === 'workflow' && item.status !== 'running')
      .map((item) => item.id)
    if (settled.some((id) => stopping.has(id)))
      registry.update(stoppingWorkflowsAtom, (ids) => {
        const next = new Set(ids)
        for (const id of settled) next.delete(id)
        return next
      })
  }, [items, registry, stopping])

  useEffect(() => {
    if (optimistic && (live || (status && promptCount === 0)))
      registry.update(pendingTurnsAtom, (ids) => withoutId(ids, threadId))
  }, [live, optimistic, promptCount, registry, status, threadId])

  // The resumed turn's opening message, hidden like every restart note, moves the thread on.
  const held = heldByRestarts(items)
  useEffect(() => {
    if (continuing && !held) registry.update(continuingAtom, (ids) => withoutId(ids, threadId))
  }, [continuing, held, registry, threadId])

  return {
    items: pending.length > 0 ? [...overlaid, ...pendingUserItems(pending)] : overlaid,
    // the server's items with local answers applied, without optimistic prompts
    serverItems: overlaid,
    empty: overlaid.length === 0 && pending.length === 0,
    running: optimistic || live || delivering || continuing,
  }
}
