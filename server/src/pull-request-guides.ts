import type { PullRequestData } from '@jetty/shared/pull-request'
import type { PullRequestGuideState } from '@jetty/shared/wire'

import { GUIDE_MIN_CHANGED_LINES } from '@jetty/shared/wire'
import { Cause, Effect, Scope, Semaphore } from 'effect'

import type { GuideMetrics } from './pr-guide'
import type { createPullRequests, PullRequestRef } from './pull-requests'
import type { Store, StoredPullRequestGuide } from './store'

import { generateGuide } from './pr-guide'
import { guideInput } from './pr-guide/hunks'
import { StoreError } from './store'

const GUIDE_MODEL = { model: 'claude-sonnet-5-5', effort: 'medium' } as const

export function createPullRequestGuides(
  store: Store,
  pulls: ReturnType<typeof createPullRequests>,
  scope: Scope.Scope
) {
  const admission = Semaphore.makeUnsafe(1)
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

  function get(ref: PullRequestRef) {
    return Effect.gen(function* () {
      let snapshot = yield* pulls.get(ref)
      if (!snapshot.data) snapshot = yield* pulls.refresh(ref)
      if (!snapshot.data)
        return yield* Effect.fail(new StoreError('internal', snapshot.error ?? 'PR is unavailable'))
      const data = snapshot.data
      const headSha = data.pull.head.sha
      return yield* Effect.gen(function* () {
        const rows = yield* store.getPullRequestGuides(ref.repo, ref.number)
        const current = rows.find((row) => row.headSha === headSha)
        if (current?.status === 'ready' || current?.status === 'skipped')
          return {
            status: current.status,
            headSha,
            outdated: false,
            ...(current.guide ? { guide: current.guide } : {}),
          } satisfies PullRequestGuideState
        const key = `${ref.repo}\0${ref.number}\0${headSha}`
        const older = rows.find(
          (row) => row.headSha !== headSha && row.status === 'ready' && row.guide
        )
        const state: PullRequestGuideState = {
          status: 'generating',
          headSha,
          outdated: !!older,
          ...(older?.guide ? { guide: older.guide } : {}),
        }
        if (running.has(key)) return state
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
          return { status: 'skipped', headSha, outdated: false } as const
        running.add(key)
        yield* generate(ref, data, row).pipe(
          Effect.ensuring(Effect.sync(() => running.delete(key))),
          Effect.forkIn(scope)
        )
        return state
      }).pipe(admission.withPermit)
    })
  }

  return { get }
}
