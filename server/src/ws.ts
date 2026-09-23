import type { ChromePushData, ThreadMeta, RateLimits, WireError } from '@jetty/shared/wire'

import { JettyRpcs, type ThreadUpdate } from '@jetty/shared/rpc'
import { Effect, Fiber, Stream } from 'effect'

import type { Hub } from './hub'
import type { Orchestrator } from './orchestrator'
import type { Store } from './store'

import { GitDiff } from './diff'
import { FileBrowser } from './fs-browse'
import { FileSearch } from './fs-search'
import { Skills } from './skills'
import { StoreError } from './store'

function wireError(error: unknown): WireError {
  return {
    code: error instanceof StoreError ? error.code : 'internal',
    message: error instanceof Error ? error.message : String(error),
  }
}

export function threadSubscription(
  store: Store,
  orch: Orchestrator,
  hub: Hub,
  params: { readonly threadId: string; readonly afterSeq?: number }
) {
  return Stream.unwrap(
    orch.withPublication(
      params.threadId,
      Effect.gen(function* () {
        yield* store.requireThread(params.threadId)
        const snapshot = yield* store.getThreadState(params.threadId)
        const initial: ThreadUpdate[] = []
        if (params.afterSeq === undefined) {
          initial.push({ type: 'snapshot', snapshot, seq: snapshot.lastSeq })
        } else {
          for (const event of yield* store.getEventsAfter(params.threadId, params.afterSeq)) {
            initial.push({ type: 'event', ...event })
          }
          initial.push({ type: 'ready', seq: snapshot.lastSeq })
        }
        const queue = yield* hub.subscribeThread(params.threadId)
        return Stream.concat(Stream.fromIterable(initial), Stream.fromQueue(queue))
      }).pipe(Effect.mapError(wireError))
    )
  )
}

export function createRpcHandlers(
  store: Store,
  orch: Orchestrator,
  hub: Hub,
  getUsage: () => RateLimits | null
) {
  return Effect.gen(function* () {
    const admissionScope = yield* Effect.scope
    const browser = yield* FileBrowser
    const search = yield* FileSearch
    const skills = yield* Skills
    const diff = yield* GitDiff

    function mutation<A, E, R>(effect: Effect.Effect<A, E, R>) {
      return hub
        .withChromePublication(effect.pipe(Effect.uninterruptible))
        .pipe(Effect.mapError(wireError))
    }

    function upsertThread<E>(effect: Effect.Effect<ThreadMeta, E>) {
      return mutation(
        effect.pipe(
          Effect.tap((thread) =>
            Effect.sync(() => hub.pushChrome({ type: 'thread.upserted', thread }))
          )
        )
      )
    }

    function requireProject(projectId: string) {
      return store
        .getProject(projectId)
        .pipe(
          Effect.flatMap((project) =>
            project
              ? Effect.succeed(project)
              : Effect.fail(new StoreError('not_found', `Project ${projectId} not found`))
          )
        )
    }

    return JettyRpcs.of({
      'chrome.subscribe': () =>
        Stream.unwrap(
          hub.withChromePublication(
            Effect.gen(function* () {
              const projects = yield* store.listProjects()
              const threads = yield* store.listThreads()
              const usage = getUsage()
              const queue = yield* hub.subscribeChrome()
              const snapshot: ChromePushData = {
                type: 'snapshot',
                projects,
                threads,
                ...(usage ? { usage } : {}),
              }
              return Stream.concat(Stream.succeed(snapshot), Stream.fromQueue(queue))
            }).pipe(Effect.mapError(wireError))
          )
        ),
      'thread.subscribe': (params) => threadSubscription(store, orch, hub, params),
      'project.create': (params) =>
        mutation(
          Effect.gen(function* () {
            const project = yield* store.createProject(params.path)
            hub.pushChrome({ type: 'project.upserted', project })
            return { project }
          })
        ),
      'thread.create': (params) =>
        upsertThread(store.createThread(params.projectId, params.id)).pipe(
          Effect.map((thread) => ({ thread }))
        ),
      'thread.archive': (params) =>
        upsertThread(store.archiveThread(params.threadId)).pipe(Effect.as(null)),
      'thread.rename': (params) =>
        upsertThread(store.renameThread(params.threadId, params.title)).pipe(Effect.as(null)),
      'thread.pin': (params) =>
        upsertThread(store.pinThread(params.threadId, params.pinned)).pipe(Effect.as(null)),
      'thread.delete': (params) =>
        orch.deleteThread(params.threadId).pipe(Effect.as(null), Effect.mapError(wireError)),
      'fs.browse': (params) => browser.browse(params.partialPath).pipe(Effect.mapError(wireError)),
      'fs.search': (params) =>
        Effect.gen(function* () {
          const project = yield* requireProject(params.projectId)
          return { files: yield* search.searchFiles(project.path, params.query, params.limit) }
        }).pipe(Effect.mapError(wireError)),
      'skills.list': (params) =>
        Effect.gen(function* () {
          if (!params.projectId) return { skills: yield* skills.listSkills() }
          const project = yield* requireProject(params.projectId)
          return { skills: yield* skills.listSkills({ projectPath: project.path }) }
        }).pipe(Effect.mapError(wireError)),
      'thread.diff': (params) =>
        Effect.gen(function* () {
          const thread = yield* store.getThread(params.threadId)
          const project = thread && (yield* store.getProject(thread.projectId))
          if (!project) return { diff: '' }
          return yield* diff.computeThreadDiff(project.path)
        }).pipe(Effect.mapError(wireError)),
      'turn.start': (params) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkIn(orch.startTurnEffect(params), admissionScope)
          return yield* Fiber.join(fiber)
        }).pipe(Effect.mapError(wireError)),
      'turn.interrupt': (params) =>
        orch.interrupt(params.threadId).pipe(Effect.as(null), Effect.mapError(wireError)),
      'approval.respond': (params) =>
        orch
          .respondApproval(
            params.threadId,
            params.itemId,
            params.decision,
            params.message,
            params.updatedPermissions ? [...params.updatedPermissions] : undefined
          )
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'question.respond': (params) =>
        orch
          .respondQuestion(params.threadId, params.itemId, params.answers)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
    })
  })
}
