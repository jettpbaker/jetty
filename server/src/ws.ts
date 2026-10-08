import type {
  ModelDiscovery,
  ChromePushData,
  ProviderModel,
  ProviderUsage,
  ThreadMeta,
} from '@jetty/shared/wire'

import { JettyRpcs, type ThreadUpdate } from '@jetty/shared/rpc'
import { WireError } from '@jetty/shared/wire'
import { newId } from '@jetty/shared/wire'
import { Cause, Effect, Fiber, Schema, Stream } from 'effect'
import { join } from 'node:path'

import type { Hub } from './hub'
import type { Orchestrator } from './orchestrator'
import type { Store } from './store'
import type { Worktrees } from './worktrees'

import { botUserName, createBotHome } from './bot-home'
import { GitDiff } from './diff'
import { FileBrowser } from './fs-browse'
import { FileSearch } from './fs-search'
import { uploadGithubAttachment } from './github-upload'
import { prefetchIssue } from './issues'
import { createPullRequestGuides } from './pull-request-guides'
import {
  createPullRequestLinks,
  createPullRequestLists,
  createPullRequests,
  githubConnection,
  pullRequestDiffFile,
  pullRequestCommitFiles,
  validPullRequestRef,
  validRepo,
} from './pull-requests'
import { Skills } from './skills'
import { StoreError } from './store'

// Idempotent, so handlers can map at any depth without re-wrapping.
function wireError(error: unknown): WireError {
  if (Schema.is(WireError)(error)) return error
  return {
    code: error instanceof StoreError ? error.code : 'internal',
    message: error instanceof Error ? error.message : String(error),
  }
}

function fromPromise<A>(run: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: (error) => error })
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
  getModels: () => readonly ProviderModel[] | null,
  refreshModels: (force?: boolean) => Effect.Effect<void> = () => Effect.void,
  pullRequests = createPullRequests(store, hub),
  worktrees: Worktrees,
  getModelDiscovery: () => ModelDiscovery = () => ({
    claude: 'loading',
    codex: 'loading',
    grok: 'loading',
  }),
  getProviderUsage: (provider: ProviderUsage['provider']) => Effect.Effect<ProviderUsage> = (
    provider
  ) => Effect.succeed({ provider, connected: false, windows: [] }),
  home = process.env.JETTY_HOME ?? ''
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

    function wakeBot(id: string) {
      return Effect.gen(function* () {
        const queued = {
          id: newId(),
          text: `${yield* fromPromise(() => botUserName())} just created you.`,
          from: { threadId: id, title: 'Jetty' },
          hop: 0,
          createdAt: Date.now(),
        }
        yield* store.enqueue(id, queued)
        yield* Effect.forkIn(
          orch.startTurnEffect({ threadId: id, text: queued.text, queued }),
          admissionScope
        )
      })
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

    // Where the thread's agent works, and the commit its Branch diff scope starts from.
    function threadRoot(threadId: string, scope?: 'branch' | 'uncommitted') {
      return Effect.gen(function* () {
        return {
          path: yield* fromPromise(() => worktrees.root(threadId)),
          baseCommit: scope === 'branch' ? yield* store.getThreadBaseCommit(threadId) : undefined,
        }
      })
    }

    function refreshInBackground(ref: { repo: string; number: number }) {
      return pullRequests.refreshIfStale(ref).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(cause)
            yield* store.savePullRequest({
              ...ref,
              status: 'unavailable',
              error: String(Cause.squash(cause)),
              refreshedAt: Date.now(),
            })
            hub.pushPullRequest(yield* pullRequests.get(ref))
          }).pipe(Effect.catchCause((cause) => Effect.logError(cause)))
        ),
        Effect.forkIn(admissionScope)
      )
    }

    const pullRequestLinks = createPullRequestLinks(store, hub, pullRequests, admissionScope)
    const pullRequestGuides = createPullRequestGuides(store, pullRequests, admissionScope)
    const pullRequestLists = createPullRequestLists(
      store,
      hub,
      pullRequests,
      pullRequestGuides,
      admissionScope
    )
    yield* Stream.tick('5 seconds').pipe(
      Stream.mapEffect(() => pullRequestLists.poll().pipe(Effect.catch(() => Effect.void))),
      Stream.runDrain,
      Effect.forkIn(admissionScope)
    )

    function checkedRef(ref: {
      repo: string
      number: number
    }): Effect.Effect<{ repo: string; number: number }, StoreError> {
      return validPullRequestRef(ref)
        ? Effect.succeed(ref)
        : Effect.fail(new StoreError('invalid_params', 'Invalid GitHub pull request reference'))
    }

    return JettyRpcs.of({
      'settings.setBranchPrefix': ({ prefix }) =>
        mutation(
          store.setBranchPrefix(prefix).pipe(
            Effect.tap(() => Effect.sync(() => hub.pushChrome({ type: 'branchPrefix', prefix }))),
            Effect.as(null)
          )
        ),
      'project.branches': ({ projectId, localOnly }) =>
        requireProject(projectId).pipe(
          Effect.flatMap((project) =>
            fromPromise(() => worktrees.branches(project.path, localOnly))
          ),
          Effect.mapError(wireError)
        ),
      // Archive and delete take the thread's children with it, so their changes count too.
      'thread.worktreeChanges': ({ threadId }) =>
        store.threadTree(threadId).pipe(
          Effect.flatMap((tree) =>
            fromPromise(() =>
              Promise.all(tree.map((thread) => worktrees.dirty(thread.id))).then((counts) =>
                counts.reduce((sum, count) => sum + count, 0)
              )
            )
          ),
          Effect.map((count) => ({ count })),
          Effect.mapError(wireError)
        ),
      'thread.retrySetup': ({ threadId }) =>
        orch
          .withAdmission(
            threadId,
            fromPromise((signal) => worktrees.prepare(threadId, signal)).pipe(
              Effect.interruptible,
              Effect.andThen(orch.setQueuePaused(threadId, false))
            )
          )
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'github.connection': () => Effect.promise(githubConnection).pipe(Effect.mapError(wireError)),
      'settings.providerUsage': ({ provider }) => getProviderUsage(provider),
      'models.refresh': ({ force }) => refreshModels(force).pipe(Effect.as(null)),
      'settings.setTitleModel': (choice) =>
        mutation(
          store.setTitleModel(choice).pipe(
            Effect.tap(() => Effect.sync(() => hub.pushChrome({ type: 'titleModel', ...choice }))),
            Effect.as(null)
          )
        ),
      'settings.setAgentBehaviour': ({ key, enabled }) =>
        mutation(
          store.setAgentBehaviour(key, enabled).pipe(
            Effect.andThen(store.getAgentBehaviours()),
            Effect.tap((behaviours) =>
              Effect.sync(() => hub.pushChrome({ type: 'agentBehaviours', behaviours }))
            ),
            Effect.as(null)
          )
        ),
      'bot.presence': ({ botId, draft }, { client }) =>
        Stream.unwrap(hub.watchBotPresence(client.id, botId, draft).pipe(Effect.as(Stream.never))),
      'github.activity': ({ activity }, { client }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* hub.watchClientActivity(client.id, activity)
            if (activity !== 'hidden')
              yield* pullRequestLists.refreshOnArrival().pipe(
                Effect.catch(() => Effect.void),
                Effect.forkIn(admissionScope)
              )
            return Stream.never
          })
        ),
      'chrome.subscribe': (_, { client }) =>
        Stream.unwrap(
          hub.withChromePublication(
            Effect.gen(function* () {
              yield* hub.watchGithubActivity(client.id)
              const projects = yield* store.listProjects()
              const threads = yield* store.listThreads()
              const bots = yield* store.listBots()
              hub.setThreads(threads)
              const models = getModels()
              const modelDiscovery = getModelDiscovery()
              const branchPrefix = yield* store.getBranchPrefix()
              const titleModel = yield* store.getTitleModel()
              const agentBehaviours = yield* store.getAgentBehaviours()
              const queue = yield* hub.subscribeChrome()
              const snapshot: ChromePushData = {
                type: 'snapshot',
                serverTime: Date.now(),
                projects,
                threads: threads.map(hub.decorateThread),
                bots,
                ...(models ? { models } : {}),
                modelDiscovery,
                providerCapabilities: orch.providerCapabilities(),
                branchPrefix,
                titleModel,
                agentBehaviours,
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
            hub.pushChrome({ type: 'project.upserted', project: project })
            return { project }
          })
        ),
      // Each thread goes through the normal delete (worktree and attachment cleanup) first.
      'project.delete': (params) =>
        Effect.gen(function* () {
          yield* requireProject(params.projectId)
          for (const thread of yield* store.listThreads())
            if (thread.projectId === params.projectId && (yield* store.getThread(thread.id)))
              yield* orch.deleteThread(thread.id)
          yield* mutation(
            store
              .deleteProject(params.projectId)
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() =>
                    hub.pushChrome({ type: 'project.removed', projectId: params.projectId })
                  )
                )
              )
          )
          return null
        }).pipe(Effect.mapError(wireError)),
      'project.setIcon': (params) =>
        mutation(
          store.setProjectIcon(params.projectId, params.icon).pipe(
            Effect.tap((project) =>
              Effect.sync(() => hub.pushChrome({ type: 'project.upserted', project: project }))
            ),
            Effect.as(null)
          )
        ),
      'project.rename': (params) =>
        mutation(
          store.renameProject(params.projectId, params.title).pipe(
            Effect.tap((project) =>
              Effect.sync(() => hub.pushChrome({ type: 'project.upserted', project: project }))
            ),
            Effect.as(null)
          )
        ),
      'thread.create': (params) =>
        Effect.gen(function* () {
          const existing = yield* store.getThread(params.id)
          if (existing?.projectId === params.projectId) return { thread: existing }
          const project = yield* requireProject(params.projectId)
          const environment =
            params.environment ??
            (yield* fromPromise(() => worktrees.defaultEnvironment(project.path)))
          const baseCommit =
            environment === 'worktree'
              ? yield* fromPromise(() => worktrees.resolveRef(project.path, params.ref))
              : undefined
          const thread = yield* upsertThread(
            store.transaction(
              Effect.gen(function* () {
                // A create for the same id may have landed while this one resolved its environment.
                const raced = yield* store.getThread(params.id)
                const thread = yield* store.createThread(params.projectId, params.id)
                if (raced) return thread
                yield* store.setThreadEnvironment(params.id, baseCommit)
                return yield* store.requireThread(params.id)
              })
            )
          )
          return { thread }
        }).pipe(Effect.mapError(wireError)),
      'thread.archive': (params) =>
        orch
          .archiveThread(params.threadId, params.archived)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
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
          const threadId = params.threadId
          const cwd = threadId ? yield* fromPromise(() => worktrees.root(threadId)) : project.path
          return {
            files: yield* search.searchFiles(cwd, params.query, params.limit),
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
          const root = yield* threadRoot(params.threadId, params.scope)
          return yield* diff.computeThreadDiff(root.path, root.baseCommit)
        }).pipe(Effect.mapError(wireError)),
      'thread.diffFile': (params) =>
        threadRoot(params.threadId, params.scope).pipe(
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
      'thread.readDirectory': (params) =>
        threadRoot(params.threadId).pipe(
          Effect.flatMap((root) => diff.readProjectDirectory(root.path, params.path)),
          Effect.map((entries) => ({ entries })),
          Effect.mapError(wireError)
        ),
      'thread.writeFile': (params) =>
        threadRoot(params.threadId).pipe(
          Effect.flatMap((root) =>
            diff.writeProjectFile(root.path, params.path, params.contents, params.base)
          ),
          Effect.mapError(wireError)
        ),
      'pullRequest.link': (params) =>
        pullRequestLinks.link(params.threadId, params.reference).pipe(Effect.mapError(wireError)),
      'pullRequest.unlink': (params) =>
        Effect.gen(function* () {
          const ref = yield* pullRequestLinks.resolve(params.threadId, params.reference)
          const thread = yield* store.unlinkPullRequest(params.threadId, ref.repo, ref.number)
          hub.pushChrome({ type: 'thread.upserted', thread })
          return { thread }
        }).pipe(Effect.mapError(wireError)),
      'pullRequest.get': (ref) =>
        Effect.gen(function* () {
          yield* checkedRef(ref)
          const snapshot = yield* pullRequests.get(ref)
          yield* refreshInBackground(ref)
          return snapshot
        }).pipe(Effect.mapError(wireError)),
      'pullRequest.prefetch': (ref) =>
        checkedRef(ref).pipe(Effect.flatMap(pullRequests.prefetch), Effect.mapError(wireError)),
      'pullRequest.guide': (ref) =>
        checkedRef(ref).pipe(Effect.flatMap(pullRequestGuides.get), Effect.mapError(wireError)),
      'issue.prefetch': (ref) =>
        (validPullRequestRef(ref)
          ? prefetchIssue({ repo: ref.repo.toLowerCase(), number: ref.number })
          : Effect.fail(new StoreError('invalid_params', 'Invalid GitHub issue reference'))
        ).pipe(Effect.mapError(wireError)),
      'pullRequest.refresh': (ref) =>
        checkedRef(ref).pipe(Effect.flatMap(pullRequests.refresh), Effect.mapError(wireError)),
      'pullRequest.diffFile': (params) =>
        Effect.tryPromise({
          try: () => pullRequestDiffFile(params),
          catch: (error) =>
            error instanceof StoreError
              ? error
              : new StoreError('internal', (error as Error).message),
        }).pipe(Effect.mapError(wireError)),
      'pullRequest.reviewerCandidates': ({ repo, query }) =>
        (validRepo(repo) && query.length <= 100
          ? Effect.tryPromise({
              try: () => pullRequests.reviewerCandidates(repo, query.trim()),
              catch: (error) => new StoreError('internal', (error as Error).message),
            })
          : Effect.fail(new StoreError('invalid_params', 'Invalid reviewer search'))
        ).pipe(Effect.mapError(wireError)),
      'pullRequest.setReviewRequest': ({ login, requested, kind, ...ref }) =>
        Effect.gen(function* () {
          yield* checkedRef(ref)
          return yield* pullRequests.setReviewRequest(ref, login, requested, kind)
        }).pipe(Effect.mapError(wireError)),
      'pullRequest.updateTitle': ({ title, ...ref }) =>
        checkedRef(ref).pipe(
          Effect.flatMap(() => pullRequests.updateTitle(ref, title)),
          Effect.mapError(wireError)
        ),
      'pullRequest.updateBody': ({ body, ...ref }) =>
        checkedRef(ref).pipe(
          Effect.flatMap(() => pullRequests.updateBody(ref, body)),
          Effect.mapError(wireError)
        ),
      'pullRequest.setState': ({ state, ...ref }) =>
        checkedRef(ref).pipe(
          Effect.flatMap(() => pullRequests.setState(ref, state)),
          Effect.mapError(wireError)
        ),
      'pullRequest.comment': ({ body, ...ref }) =>
        checkedRef(ref).pipe(
          Effect.flatMap(() => pullRequests.comment(ref, body)),
          Effect.mapError(wireError)
        ),
      'pullRequest.reply': ({ commentId, body, ...ref }) =>
        checkedRef(ref).pipe(
          Effect.flatMap(() => pullRequests.reply(ref, commentId, body)),
          Effect.mapError(wireError)
        ),
      'pullRequest.resolveThread': ({ threadId, resolved, ...ref }) =>
        checkedRef(ref).pipe(
          Effect.flatMap(() => pullRequests.resolveThread(ref, threadId, resolved)),
          Effect.mapError(wireError)
        ),
      'pullRequest.setViewed': ({ path, viewed, ...ref }) =>
        checkedRef(ref).pipe(
          Effect.flatMap(() => pullRequests.setViewed(ref, path, viewed)),
          Effect.mapError(wireError)
        ),
      'pullRequest.commitFiles': ({ repo, sha }) =>
        Effect.tryPromise({
          try: () => pullRequestCommitFiles(repo, sha),
          catch: (error) =>
            error instanceof StoreError ? error : new StoreError('internal', String(error)),
        }).pipe(Effect.mapError(wireError)),
      'pullRequest.merge': ({ sha, mergeMethod, ...ref }) =>
        checkedRef(ref).pipe(
          Effect.flatMap(() => pullRequests.merge(ref, sha, mergeMethod)),
          Effect.mapError(wireError)
        ),
      'pullRequest.uploadAttachment': (params) =>
        Effect.tryPromise({
          try: () => uploadGithubAttachment(params),
          catch: wireError,
        }),
      'pullRequest.subscribe': (ref, { client }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* checkedRef(ref)
            yield* hub.watchGithubActivity(client.id)
            yield* pullRequests.watch(ref, client.id)
            const queue = yield* hub.subscribePullRequest(ref.repo, ref.number)
            const snapshot = yield* pullRequests.get(ref)
            yield* refreshInBackground(ref)
            // Refreshes reach the client through the hub; the poll itself emits nothing.
            const periodic = Stream.tick('5 seconds').pipe(
              Stream.mapEffect(() => pullRequests.poll(ref).pipe(Effect.catch(() => Effect.void))),
              Stream.drain
            )
            return Stream.concat(
              Stream.succeed(snapshot),
              Stream.merge(Stream.fromQueue(queue), periodic)
            )
          }).pipe(Effect.mapError(wireError))
        ),
      'pullRequestList.prefetch': ({ tab }) =>
        pullRequests.prefetchList(tab).pipe(Effect.mapError(wireError)),
      'pullRequestList.refresh': ({ tab, maxAge }) =>
        pullRequestLists.refresh(tab, maxAge).pipe(Effect.mapError(wireError)),
      'pullRequestList.subscribe': ({ tab }, { client }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* hub.watchGithubActivity(client.id)
            yield* pullRequestLists.watch(tab, client.id)
            const queue = yield* hub.subscribePullRequestList(tab)
            const list = yield* pullRequestLists.get(tab)
            yield* pullRequestLists.refreshIfStale(tab).pipe(
              Effect.catch(() => Effect.void),
              Effect.forkIn(admissionScope)
            )
            return Stream.concat(Stream.succeed(list), Stream.fromQueue(queue))
          }).pipe(Effect.mapError(wireError))
        ),
      'queue.add': (params) =>
        store
          .noteUserMessage()
          .pipe(
            Effect.andThen(
              orch
                .enqueue(
                  params.threadId,
                  params.messageId,
                  params.text,
                  params.attachments,
                  params.replyTo
                )
                .pipe(Effect.as(null))
            ),
            Effect.mapError(wireError)
          ),
      'queue.remove': (params) =>
        orch
          .editQueued(params.threadId, params.messageId)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
      'queue.restore': (params) =>
        orch
          .restoreQueued(params.threadId, params.messageId)
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
      'thread.compact': ({ threadId }) =>
        orch.compact(threadId).pipe(Effect.as(null), Effect.mapError(wireError)),
      'thread.continue': ({ threadId }) =>
        orch.continueThread(threadId).pipe(Effect.as(null), Effect.mapError(wireError)),
      'turn.start': (params) =>
        Effect.gen(function* () {
          yield* store.noteUserMessage()
          const fiber = yield* Effect.forkIn(orch.startTurnEffect(params), admissionScope)
          return yield* Fiber.join(fiber)
        }).pipe(Effect.mapError(wireError)),
      'turn.interrupt': (params) =>
        orch.interrupt(params.threadId).pipe(Effect.as(null), Effect.mapError(wireError)),
      'background.stop': (params) =>
        orch
          .stopBackgroundTasks(params.threadId, params.taskId)
          .pipe(Effect.as(null), Effect.mapError(wireError)),
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
      'bot.create': (params) =>
        mutation(
          Effect.gen(function* () {
            const previous = yield* store.getBot(params.id)
            if (previous) {
              const state = yield* store.getThreadState(params.id)
              const thread = yield* store.requireThread(params.id)
              if (!state.items.length && !thread.pendingMessages?.length) yield* wakeBot(params.id)
              return { bot: previous }
            }
            if (params.provider !== 'claude')
              return yield* Effect.fail(
                new StoreError('invalid_params', 'Only Claude bots are available')
              )
            if (params.effort === 'max')
              return yield* Effect.fail(
                new StoreError('invalid_params', "max isn't available to bots; use xhigh")
              )
            const model = getModels()?.find(
              (item) => item.provider === 'claude' && item.id === params.model
            )
            if (!model)
              return yield* Effect.fail(
                new StoreError('invalid_params', `Unknown Claude model ${params.model}`)
              )
            if (params.effort && !model.efforts.includes(params.effort))
              return yield* Effect.fail(
                new StoreError('invalid_params', 'Unsupported effort for this model')
              )
            if (
              params.projectId &&
              !(yield* store.listProjects()).some((project) => project.id === params.projectId)
            )
              return yield* Effect.fail(new StoreError('invalid_params', 'Project not found'))
            const path = join(home, 'bots', params.id)
            yield* fromPromise(() => createBotHome(path))
            const created = yield* store.createBotRecord(params, path)
            const bot = yield* store.getBot(params.id)
            if (!bot) return yield* Effect.fail(new StoreError('internal', 'Bot was not saved'))
            hub.pushChrome({ type: 'bot.upserted', bot })
            if (created) yield* wakeBot(params.id)
            return { bot }
          })
        ),
      'bot.conversation': ({ botId, otherBotId }) =>
        Effect.gen(function* () {
          if (botId === otherBotId)
            return yield* Effect.fail(
              new StoreError('invalid_params', 'Conversation requires two different bots')
            )
          if (!(yield* store.isBot(botId)) || !(yield* store.isBot(otherBotId)))
            return yield* Effect.fail(new StoreError('not_found', 'Bot not found'))
          return { messages: yield* store.getBotConversation(botId, otherBotId) }
        }).pipe(Effect.mapError(wireError)),
      'bot.update': (params) =>
        Effect.gen(function* () {
          if (params.name !== undefined && !params.name.trim())
            return yield* Effect.fail(new StoreError('invalid_params', 'Bot name is required'))
          if (params.effort === 'max')
            return yield* Effect.fail(
              new StoreError('invalid_params', "max isn't available to bots; use xhigh")
            )
          const bot = yield* store.getBot(params.botId)
          if (!bot) return yield* Effect.fail(new StoreError('not_found', 'Bot not found'))
          const id = params.model ?? bot.model
          const model = getModels()?.find((model) => model.provider === 'claude' && model.id === id)
          if (params.model !== undefined && !model)
            return yield* Effect.fail(
              new StoreError('invalid_params', `Unknown Claude model ${params.model}`)
            )
          if (params.effort && !model?.efforts.includes(params.effort))
            return yield* Effect.fail(
              new StoreError('invalid_params', 'Unsupported effort for this model')
            )
          if (params.fast && !model?.fast)
            return yield* Effect.fail(
              new StoreError('invalid_params', `${model?.name ?? id} doesn't support Fast`)
            )
          return {
            bot: yield* orch.updateBot(params, params.model === undefined ? undefined : model),
          }
        }).pipe(Effect.mapError(wireError)),
      'bot.send': (params) =>
        Effect.gen(function* () {
          yield* store.noteUserMessage()
          const bot = yield* store.getBot(params.botId)
          if (!bot) return yield* Effect.fail(new StoreError('not_found', 'Bot not found'))
          const persistedAttachments = []
          if (params.attachmentIds?.length) {
            const state = yield* store.getThreadState(params.botId)
            for (const id of params.attachmentIds) {
              const attachment = state.items
                .flatMap((item) =>
                  item.kind === 'user_message' && !item.from ? item.attachments : []
                )
                .find((item) => item.id === id)
              if (!attachment)
                return yield* Effect.fail(new StoreError('invalid_params', 'Attachment not found'))
              persistedAttachments.push(attachment)
            }
          }
          const { replyTo } = params
          if (replyTo) {
            const state = yield* store.getThreadState(params.botId)
            const quoted = state.items.find((item) => item.id === replyTo.itemId)
            if (!quoted || (quoted.kind !== 'assistant_message' && quoted.kind !== 'user_message'))
              return yield* Effect.fail(
                new StoreError('invalid_params', 'Quoted message not found')
              )
          }
          const openQuestions = (yield* store.getThreadState(params.botId)).items.filter(
            (item) =>
              item.kind === 'question' &&
              !item.agentId &&
              !item.answers &&
              !item.dismissed &&
              !item.skipped &&
              !item.completedAt
          )
          yield* mutation(store.markBotSeen(params.botId))
          orch.botUserMessage(params.botId)
          const fiber = yield* Effect.forkIn(
            orch.startTurnEffect({
              threadId: params.botId,
              messageId: params.messageId,
              text: params.text,
              persistedAttachments,
              replyTo,
            }),
            admissionScope
          )
          yield* Fiber.join(fiber)
          // Settled after the message is queued, so it rides in with the question's tool result.
          for (const question of openQuestions)
            yield* orch
              .respondQuestion(params.botId, question.id, null, true)
              .pipe(Effect.catchCause((cause) => Effect.logWarning(cause)))
          yield* mutation(
            Effect.gen(function* () {
              const updated = yield* store.getBot(params.botId)
              if (updated) hub.pushChrome({ type: 'bot.upserted', bot: updated })
            })
          )
          return null
        }).pipe(Effect.mapError(wireError)),
      'bot.setAllowRules': ({ botId, rules }) =>
        mutation(orch.setBotAllowRules(botId, rules).pipe(Effect.as(null))),
      'bot.markSeen': ({ botId }) =>
        mutation(
          Effect.gen(function* () {
            yield* store.markBotSeen(botId)
            const bot = yield* store.getBot(botId)
            if (!bot) return yield* Effect.fail(new StoreError('not_found', 'Bot not found'))
            hub.pushChrome({ type: 'bot.upserted', bot })
            return null
          })
        ),
    })
  })
}
