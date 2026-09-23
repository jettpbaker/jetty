import type {
  ChromePushData,
  ProviderModel,
  RateLimits,
  ThreadMeta,
  WireError,
} from '@jetty/shared/wire'

import { JettyRpcs, type ThreadUpdate } from '@jetty/shared/rpc'
import { Effect, Fiber, Stream } from 'effect'

import type { EnvironmentManager } from './containers'
import type { Hub } from './hub'
import type { Orchestrator } from './orchestrator'
import type { Store } from './store'

import { containerDefaults, gitCommit } from './containers'
import { GitDiff } from './diff'
import { FileBrowser } from './fs-browse'
import { FileSearch } from './fs-search'
import {
  createPullRequests,
  githubConnection,
  parsePullRequestUrl,
  projectRemote,
  resolvePullRequestReference,
  validPullRequestRef,
} from './pull-requests'
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
  getUsage: () => RateLimits | null,
  getModels: () => readonly ProviderModel[] | null,
  refreshModels: (force?: boolean) => Effect.Effect<void> = () => Effect.void,
  pullRequests = createPullRequests(store, hub),
  containers?: EnvironmentManager
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

    // Where the thread's agent works: its container checkout, or the project folder.
    function threadRoot(threadId: string) {
      return Effect.gen(function* () {
        const thread = yield* store.requireThread(threadId)
        const project = yield* requireProject(thread.projectId)
        const record =
          thread.environment === 'container' && containers
            ? yield* Effect.promise(() => containers.record(thread.id))
            : null
        if (thread.environment === 'container' && !record)
          return yield* Effect.fail(new StoreError('not_found', 'Container checkout is not ready'))
        return {
          path: record?.checkoutPath ?? project.path,
          baseCommit: record?.baseCommit ?? undefined,
        }
      })
    }

    function reference(threadId: string, value: string) {
      return Effect.gen(function* () {
        const thread = yield* store.requireThread(threadId)
        const url = parsePullRequestUrl(value.trim())
        if (url) return url
        const project = yield* requireProject(thread.projectId)
        const remote = yield* Effect.promise(() => projectRemote(project.path))
        return yield* resolvePullRequestReference(value, remote)
      })
    }

    function refreshInBackground(ref: { repo: string; number: number }) {
      return pullRequests.refreshIfStale(ref).pipe(
        Effect.catch(() => Effect.void),
        Effect.forkIn(admissionScope)
      )
    }

    function checkedRef(ref: { repo: string; number: number }) {
      return validPullRequestRef(ref)
        ? Effect.succeed(ref)
        : Effect.fail(new StoreError('invalid_params', 'Invalid GitHub pull request reference'))
    }

    return JettyRpcs.of({
      'containers.status': () =>
        containers
          ? Effect.tryPromise({ try: () => containers.status(), catch: wireError })
          : Effect.succeed({
              enabled: false,
              docker: false,
              ...containerDefaults,
              running: 0,
              retained: [],
              credentials: { codex: false, claude: false, grok: false },
            }),
      'containers.setMax': ({ maxRunning }) =>
        containers
          ? Effect.tryPromise({
              try: () => containers.setMaxRunning(maxRunning),
              catch: wireError,
            }).pipe(Effect.as(null))
          : Effect.fail(wireError(new StoreError('invalid_params', 'Containers are disabled'))),
      'project.containerTest': ({ projectId }) =>
        Effect.gen(function* () {
          if (!containers)
            return yield* Effect.fail(new StoreError('invalid_params', 'Containers are disabled'))
          const project = yield* requireProject(projectId)
          const registration = yield* Effect.tryPromise({
            try: () => containers.test(project),
            catch: (error) => new StoreError('invalid_params', String(error)),
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* store.setContainerRegistration(projectId, {
                  valid: false,
                  manifestHash: '',
                  imageId: '',
                  validatedAt: Date.now(),
                  providers: { codex: false, claude: false, grok: false },
                  result: error.message,
                })
                hub.pushChrome({
                  type: 'project.upserted',
                  project: yield* requireProject(projectId),
                })
                return yield* Effect.fail(error)
              })
            )
          )
          hub.pushChrome({ type: 'project.upserted', project: yield* requireProject(projectId) })
          return { result: registration.result, providers: registration.providers }
        }).pipe(Effect.mapError(wireError)),
      'thread.startDev': ({ threadId }) =>
        Effect.gen(function* () {
          if (!containers)
            return yield* Effect.fail(new StoreError('invalid_params', 'Containers are disabled'))
          const thread = yield* store.requireThread(threadId)
          if (thread.environment !== 'container')
            return yield* Effect.fail(new StoreError('invalid_params', 'Thread is local'))
          const services = yield* Effect.tryPromise({
            try: () => containers.startDev(threadId),
            catch: (error) => new StoreError('internal', String(error)),
          })
          return { services }
        }).pipe(Effect.mapError(wireError)),
      'github.connection': () => Effect.promise(githubConnection).pipe(Effect.mapError(wireError)),
      'models.refresh': ({ force }) => refreshModels(force).pipe(Effect.as(null)),
      'chrome.subscribe': () =>
        Stream.unwrap(
          hub.withChromePublication(
            Effect.gen(function* () {
              const projects = yield* store.listProjects()
              const threads = yield* store.listThreads()
              const usage = getUsage()
              const models = getModels()
              const queue = yield* hub.subscribeChrome()
              const snapshot: ChromePushData = {
                type: 'snapshot',
                projects,
                threads,
                ...(usage ? { usage } : {}),
                ...(models ? { models } : {}),
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
      'project.setIcon': (params) =>
        mutation(
          store.setProjectIcon(params.projectId, params.icon).pipe(
            Effect.tap((project) =>
              Effect.sync(() => hub.pushChrome({ type: 'project.upserted', project }))
            ),
            Effect.as(null)
          )
        ),
      'thread.create': (params) =>
        Effect.gen(function* () {
          const project = yield* requireProject(params.projectId).pipe(Effect.mapError(wireError))
          let base: string | undefined
          if (params.environment === 'container') {
            if (!containers)
              return yield* Effect.fail(
                wireError(new StoreError('invalid_params', 'Containers are disabled'))
              )
            yield* Effect.tryPromise({
              try: () => containers.registration(project),
              catch: (error) => new StoreError('invalid_params', String(error)),
            }).pipe(Effect.mapError(wireError))
            base = yield* Effect.tryPromise({
              try: () => gitCommit(project.path, params.ref),
              catch: (error) => new StoreError('invalid_params', String(error)),
            }).pipe(Effect.mapError(wireError))
          }
          const thread = yield* upsertThread(
            Effect.gen(function* () {
              yield* store.createThread(params.projectId, params.id)
              if (base) yield* store.setThreadEnvironment(params.id, 'container', base)
              return yield* store.requireThread(params.id)
            })
          )
          return { thread }
        }),
      'thread.archive': (params) =>
        upsertThread(store.archiveThread(params.threadId, params.archived)).pipe(
          Effect.tap(() =>
            params.archived && containers
              ? Effect.promise(() => containers.stop(params.threadId))
              : Effect.void
          ),
          Effect.as(null)
        ),
      'thread.rename': (params) =>
        upsertThread(store.renameThread(params.threadId, params.title)).pipe(Effect.as(null)),
      'thread.pin': (params) =>
        upsertThread(store.pinThread(params.threadId, params.pinned)).pipe(Effect.as(null)),
      'thread.markSeen': (params) =>
        upsertThread(store.markThreadSeen(params.threadId)).pipe(Effect.as(null)),
      'thread.delete': (params) =>
        orch.deleteThread(params.threadId).pipe(Effect.as(null), Effect.mapError(wireError)),
      'fs.browse': (params) => browser.browse(params.partialPath).pipe(Effect.mapError(wireError)),
      'fs.search': (params) =>
        Effect.gen(function* () {
          const project = yield* requireProject(params.projectId)
          return {
            files: yield* search.searchFiles(project.path, params.query, params.limit),
          }
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
          const record =
            thread.environment === 'container' && containers
              ? yield* Effect.promise(() => containers.record(thread.id))
              : null
          if (thread.environment === 'container' && !record) return { diff: '' }
          return yield* diff.computeThreadDiff(
            record?.checkoutPath ?? project.path,
            record?.baseCommit ?? undefined
          )
        }).pipe(Effect.mapError(wireError)),
      'thread.diffFile': (params) =>
        threadRoot(params.threadId).pipe(
          Effect.flatMap((root) =>
            diff.readDiffFile(root.path, params.path, params.prevPath, root.baseCommit)
          ),
          Effect.mapError(wireError)
        ),
      'thread.readFile': (params) =>
        threadRoot(params.threadId).pipe(
          Effect.flatMap((root) => diff.readProjectFile(root.path, params.path)),
          Effect.mapError(wireError)
        ),
      'pullRequest.link': (params) =>
        Effect.gen(function* () {
          const ref = yield* reference(params.threadId, params.reference)
          if (yield* store.hasPullRequestLink(params.threadId, ref.repo, ref.number))
            return { thread: yield* store.requireThread(params.threadId) }
          const thread = yield* store.linkPullRequest(params.threadId, ref.repo, ref.number)
          hub.pushChrome({ type: 'thread.upserted', thread })
          yield* refreshInBackground(ref)
          return { thread }
        }).pipe(Effect.mapError(wireError)),
      'pullRequest.unlink': (params) =>
        Effect.gen(function* () {
          const ref = yield* reference(params.threadId, params.reference)
          const thread = yield* store.unlinkPullRequest(params.threadId, ref.repo, ref.number)
          hub.pushChrome({ type: 'thread.upserted', thread })
          return { thread }
        }).pipe(Effect.mapError(wireError)),
      'pullRequest.get': (ref) =>
        Effect.gen(function* () {
          yield* checkedRef(ref)
          const snapshot = yield* pullRequests.get(ref)
          const pull = (snapshot.data as { pull?: { state?: string } } | undefined)?.pull
          if (
            !snapshot.refreshedAt ||
            (pull?.state !== 'closed' && Date.now() - snapshot.refreshedAt > 60_000)
          )
            yield* refreshInBackground(ref)
          return snapshot
        }).pipe(Effect.mapError(wireError)),
      'pullRequest.refresh': (ref) =>
        checkedRef(ref).pipe(Effect.flatMap(pullRequests.refresh), Effect.mapError(wireError)),
      'pullRequest.subscribe': (ref) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* checkedRef(ref)
            const queue = yield* hub.subscribePullRequest(ref.repo, ref.number)
            const snapshot = yield* pullRequests.get(ref)
            yield* refreshInBackground(ref)
            const periodic = Stream.tick('60 seconds').pipe(
              Stream.mapEffect(() =>
                pullRequests.refreshIfStale(ref).pipe(Effect.catch(() => pullRequests.get(ref)))
              )
            )
            return Stream.concat(
              Stream.succeed(snapshot),
              Stream.merge(Stream.fromQueue(queue), periodic)
            )
          }).pipe(Effect.mapError(wireError))
        ),
      'queue.add': (params) =>
        orch
          .enqueue(params.threadId, params.messageId, params.text, params.attachments)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'queue.remove': (params) =>
        orch
          .editQueued(params.threadId, params.messageId)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'queue.edit': (params) =>
        orch
          .editQueued(params.threadId, params.messageId, params.text)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'queue.hold': (params) =>
        orch
          .setQueuedEditing(params.threadId, params.messageId, true)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'queue.release': (params) =>
        orch
          .setQueuedEditing(params.threadId, params.messageId, false)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'queue.sendNow': (params) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkIn(
            orch.sendQueuedNow(params.threadId, params.messageId),
            admissionScope
          )
          yield* Fiber.join(fiber)
          return null
        }).pipe(Effect.mapError(wireError)),
      'turn.start': (params) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkIn(orch.startTurnEffect(params), admissionScope)
          return yield* Fiber.join(fiber)
        }).pipe(Effect.mapError(wireError)),
      'turn.interrupt': (params) =>
        orch.interrupt(params.threadId).pipe(Effect.as(null), Effect.mapError(wireError)),
      'workflow.stop': (params) =>
        orch
          .stopWorkflow(params.threadId, params.taskId)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'approval.respond': (params) =>
        orch
          .respondApproval(params.threadId, params.itemId, params.decision, params.message)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'question.respond': (params) =>
        orch
          .respondQuestion(params.threadId, params.itemId, params.answers)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'question.dismiss': (params) =>
        orch
          .respondQuestion(params.threadId, params.itemId, null)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
    })
  })
}
