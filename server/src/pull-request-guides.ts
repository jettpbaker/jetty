import type { PullRequestData } from '@jetty/shared/pull-request'
import type { PullRequestGuideState, PullRequestListItem } from '@jetty/shared/wire'

import { GUIDE_MIN_CHANGED_LINES } from '@jetty/shared/wire'
import { Cause, Effect, Fiber, Scope, Semaphore } from 'effect'

import type { GuideMetrics } from './pr-guide'
import type { createPullRequests, PullRequestRef } from './pull-requests'
import type { Store, StoredPullRequestGuide } from './store'

import { generateGuide } from './pr-guide'
import { guideInput } from './pr-guide/hunks'
import { StoreError } from './store'

const GUIDE_MODEL = { model: 'claude-sonnet-5-5', effort: 'medium' } as const

function guideKey(ref: PullRequestRef, headSha: string) {
  return `${ref.repo}\0${ref.number}\0${headSha}`
}

export function createPullRequestGuides(
  store: Store,
  pulls: ReturnType<typeof createPullRequests>,
  scope: Scope.Scope
) {
  const admission = Semaphore.makeUnsafe(1)
  const prefetchSlots = Semaphore.makeUnsafe(2)
  const queued = new Set<string>()
  const running = new Set<string>()

  function generate(ref: PullRequestRef, data: PullRequestData, row: StoredPullRequestGuide) {
    return Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async (signal) =>
          generateGuide(await guideInput(ref.repo, data), { ...GUIDE_MODEL, signal }),
        catch: (error) => error,
      })
      yield* store.savePullRequestGuide(ref.repo, ref.number, {
        ...row,
        ...result,
        status: 'ready',
        updatedAt: Date.now(),
      })
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause)
        return store.savePullRequestGuide(ref.repo, ref.number, {
          ...row,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && 'metrics' in error
            ? { metrics: error.metrics as GuideMetrics }
            : {}),
          updatedAt: Date.now(),
        })
      }),
      Effect.catchCause((cause) => Effect.logError('PR guide generation failed', cause))
    )
  }

  function start(ref: PullRequestRef, data: PullRequestData, prefetch = false) {
    return Effect.gen(function* () {
      const headSha = data.pull.head.sha
      const rows = yield* store.getPullRequestGuides(ref.repo, ref.number)
      const current = rows.find((row) => row.headSha === headSha)
      if (prefetch && current) return undefined
      if (current?.status === 'ready' || current?.status === 'skipped')
        return {
          state: {
            status: current.status,
            headSha,
            outdated: false,
            ...(current.guide ? { guide: current.guide } : {}),
          } satisfies PullRequestGuideState,
        }
      const key = guideKey(ref, headSha)
      const older = rows.find(
        (row) => row.headSha !== headSha && row.status === 'ready' && row.guide
      )
      const state: PullRequestGuideState = {
        status: 'generating',
        headSha,
        outdated: !!older,
        ...(older?.guide ? { guide: older.guide } : {}),
      }
      if (running.has(key)) return { state }
      const now = Date.now()
      const row: StoredPullRequestGuide = {
        status:
          data.pull.additions + data.pull.deletions < GUIDE_MIN_CHANGED_LINES
            ? 'skipped'
            : 'generating',
        headSha,
        model: GUIDE_MODEL.model,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      }
      yield* store.savePullRequestGuide(ref.repo, ref.number, row)
      if (row.status === 'skipped')
        return { state: { status: 'skipped', headSha, outdated: false } as const }
      running.add(key)
      const fiber = yield* generate(ref, data, row).pipe(
        Effect.ensuring(Effect.sync(() => running.delete(key))),
        Effect.forkIn(scope)
      )
      return { state, fiber }
    }).pipe(admission.withPermit)
  }

  function get(ref: PullRequestRef) {
    return Effect.gen(function* () {
      let snapshot = yield* pulls.get(ref)
      if (!snapshot.data) snapshot = yield* pulls.refresh(ref)
      if (!snapshot.data)
        return yield* Effect.fail(new StoreError('internal', snapshot.error ?? 'PR is unavailable'))
      const result = yield* start(ref, snapshot.data)
      return result!.state
    })
  }

  function enqueue(ref: PullRequestListItem) {
    return Effect.gen(function* () {
      if (ref.state !== 'open' || !ref.headSha) return
      if (!(yield* store.getAgentBehaviours()).prefetchPullRequestGuides) return
      const headSha = ref.headSha
      const key = guideKey(ref, headSha)
      if (queued.has(key) || running.has(key)) return
      const rows = yield* store.getPullRequestGuides(ref.repo, ref.number)
      if (rows.some((row) => row.headSha === headSha)) return
      if (queued.has(key)) return
      queued.add(key)
      yield* Effect.gen(function* () {
        if (!(yield* store.getAgentBehaviours()).prefetchPullRequestGuides) return
        const list = yield* store.getPullRequestList('for-you')
        if (
          !list.items?.some(
            (item) =>
              item.repo === ref.repo &&
              item.number === ref.number &&
              item.state === 'open' &&
              item.headSha === headSha
          )
        )
          return
        const rows = yield* store.getPullRequestGuides(ref.repo, ref.number)
        if (rows.some((row) => row.headSha === headSha)) return
        let snapshot = yield* pulls.get(ref)
        if (snapshot.status !== 'ready' || snapshot.data?.pull.head.sha !== headSha)
          snapshot = yield* pulls.refresh(ref)
        if (!(yield* store.getAgentBehaviours()).prefetchPullRequestGuides) return
        if (
          snapshot.status !== 'ready' ||
          !snapshot.data ||
          snapshot.data.pull.head.sha !== headSha ||
          snapshot.data.pull.state !== 'open' ||
          snapshot.data.pull.merged ||
          snapshot.data.pull.draft
        )
          return
        const result = yield* start(ref, snapshot.data, true)
        if (result && 'fiber' in result && result.fiber) yield* Fiber.join(result.fiber)
      }).pipe(
        prefetchSlots.withPermit,
        Effect.ensuring(Effect.sync(() => queued.delete(key))),
        Effect.catchCause((cause) => Effect.logWarning('PR guide prefetch failed', cause)),
        Effect.forkIn(scope)
      )
    })
  }

  function prefetch(items: readonly PullRequestListItem[]) {
    return Effect.forEach(items, enqueue, { discard: true })
  }

  return { get, prefetch }
}
