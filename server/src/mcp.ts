import { heldByRestarts } from '@jetty/shared/items'
import { baseModelId, findProviderModel } from '@jetty/shared/model-name'
import { newId, type ProviderModel, type WireError } from '@jetty/shared/wire'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Effect, Path, Scope } from 'effect'
import { z } from 'zod'

import type { Attachments } from './attachments'
import type { McpIdentity, McpSessions } from './mcp-sessions'
import type { Orchestrator } from './orchestrator'
import type { PullRequestLinks } from './pull-requests'
import type { Store } from './store'
import type { Worktrees } from './worktrees'

import { relayedMessage } from './jetty-instructions'
import { createSendImagesTool } from './send-images'
import { createSendVideoTool } from './send-video'
import { StoreError } from './store'

const providerNames = { claude: 'Claude', codex: 'Codex', grok: 'Grok' }
const modelKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

function modelOptions(catalog: readonly ProviderModel[]) {
  return catalog
    .map(
      (m) =>
        `${providerNames[m.provider]} ${m.name} (${m.id}; efforts: ${m.efforts.join(', ') || 'none'})`
    )
    .join('; ')
}

function matchProject(
  projects: readonly { id: string; title: string; path: string }[],
  name: string | undefined,
  callerProjectId: string
) {
  if (!name) {
    const project = projects.find((item) => item.id === callerProjectId)
    return project
      ? Effect.succeed(project)
      : Effect.fail(new StoreError('not_found', 'Project not found'))
  }
  const key = name.toLowerCase()
  const matches = projects.filter((item) => item.title.toLowerCase() === key)
  if (matches.length === 1) return Effect.succeed(matches[0]!)
  const available = projects.map((item) => item.title).join(', ') || 'none'
  return Effect.fail(
    new StoreError(
      'invalid_params',
      matches.length === 0
        ? `Unknown project ${name}. Available: ${available}`
        : `Ambiguous project ${name}. Available: ${available}`
    )
  )
}

function matchingModels(catalog: readonly ProviderModel[], name: string) {
  const key = modelKey(name)
  const exact = catalog.filter(
    (m) =>
      modelKey(m.id) === key ||
      modelKey(m.name) === key ||
      (m.resolvedId !== undefined && modelKey(m.resolvedId) === key)
  )
  if (exact.length) return exact
  const variant = catalog.filter(
    (m) =>
      baseModelId(m.id) === baseModelId(name) ||
      (m.resolvedId !== undefined && baseModelId(m.resolvedId) === baseModelId(name))
  )
  if (variant.length) return variant
  return catalog.filter((m) =>
    [m.id, m.name].some((label) =>
      label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((part) => part === name.toLowerCase())
    )
  )
}

const text = z.string().trim().min(1).max(32_000)
const requestId = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    'Any unique string. Retrying with the same one returns the first result instead of acting twice.'
  )
const createInput = z.object({
  environment: z
    .enum(['local', 'worktree'])
    .optional()
    .describe(
      "worktree: a new branch and folder of its own. local: the project checkout itself, shared with the user and other threads there. Defaults to yours, or the target project's default when you pass project."
    ),
  ref: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Worktree only: the branch, tag or commit to start from, local or on origin. Defaults to your HEAD when you're in a worktree, so commit anything the child should build on; otherwise origin's default branch, or the current branch when there's no origin."
    ),
  prompt: text.describe(
    'Everything the child needs. It sees this and the project, not your conversation.'
  ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Sidebar title: a few words naming what the thread is for. You know its purpose better than a title generated from the prompt, which is the fallback.'
    ),
  project: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Create the thread in this project (name, case-insensitive). Defaults to yours. If it doesn't match or is ambiguous, the error lists the available names."
    ),
  provider: z.enum(['claude', 'codex', 'grok']).optional(),
  model: z
    .string()
    .min(1)
    .optional()
    .describe('An id, name or unique short name from list_models.'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  notify: z
    .boolean()
    .default(true)
    .describe(
      "Default true: when it's done with work you gave it, Jetty sends you its final message. Set false for a thread you won't follow up on."
    ),
  requestId,
})
const sendInput = z.object({
  threadId: z.string(),
  text,
  steer: z
    .boolean()
    .default(false)
    .describe(
      "Deliver into its running turn now, for a correction it shouldn't finish without. The result says if it was queued instead."
    ),
  requestId,
})

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

export function createMcpHandler(
  sessions: McpSessions,
  store: Store,
  orch: Orchestrator,
  attachments: Attachments,
  models: () => readonly ProviderModel[] | null,
  pullRequestLinks: PullRequestLinks,
  archiveThread: (threadId: string) => Effect.Effect<unknown, WireError>,
  worktrees?: Worktrees
) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<Path.Path | Scope.Scope>()
    const run = Effect.runPromiseWith(context)

    function accessible(identity: McpIdentity, targetId: string) {
      return Effect.gen(function* () {
        const caller = yield* store.requireThread(identity.threadId)
        const target = yield* store.requireThread(targetId)
        if (caller.archived || target.archived)
          return yield* Effect.fail(new StoreError('not_found', `Thread ${targetId} is archived`))
        return target
      })
    }

    function ownChild(identity: McpIdentity, threadId: string) {
      return Effect.gen(function* () {
        const caller = yield* accessible(identity, identity.threadId)
        const target = yield* store.requireThread(threadId)
        if (target.parentThreadId !== caller.id)
          return yield* Effect.fail(
            new StoreError('invalid_params', 'Only your own direct child threads can be stopped')
          )
        return target
      })
    }

    // A turn in progress, including one waiting on the user, or background work the archive would stop.
    function stillWorking(status: string) {
      return (
        status === 'starting' ||
        status === 'running' ||
        status === 'awaiting_approval' ||
        status === 'monitoring'
      )
    }

    function archiveTarget(identity: McpIdentity, threadId: string) {
      return Effect.gen(function* () {
        const caller = yield* accessible(identity, identity.threadId)
        const target = yield* store.requireThread(threadId)
        if (target.archived)
          return yield* Effect.fail(new StoreError('invalid_params', 'Thread is already archived'))
        // Archiving a thread archives everything under it, so the caller and anything above it are out.
        const underTarget = yield* store.threadTree(target.id)
        if (underTarget.some((thread) => thread.id === caller.id))
          return yield* Effect.fail(
            new StoreError(
              'invalid_params',
              target.id === caller.id
                ? "You can't archive this thread. It would stop you mid-turn."
                : "You can't archive a thread above yours. It would archive you too."
            )
          )
        const underCaller = yield* store.threadTree(caller.id)
        const ownDescendant = underCaller.some((thread) => thread.id === target.id)
        if (!ownDescendant && underTarget.some((thread) => stillWorking(thread.status)))
          return yield* Effect.fail(
            new StoreError(
              'invalid_params',
              `${target.title} is still working. Ask the user, or wait until it's done.`
            )
          )
        return target
      })
    }

    function accessLevel(thread: { provider?: string; model?: string }, mode?: string) {
      if (findProviderModel(models() ?? [], thread.provider, thread.model)?.autoMode === false)
        return 0
      return mode === 'full_access' ? 2 : 1
    }

    function createThread(identity: McpIdentity, input: z.infer<typeof createInput>) {
      let baseCommit: string | undefined
      let projectId = ''
      const create = store.transaction(
        Effect.gen(function* () {
          const caller = yield* accessible(identity, identity.threadId)
          if (input.requestId) {
            const previous = yield* store.getRequest(caller.id, input.requestId, 'create_thread')
            if (previous) return previous
          }
          const turn = yield* store.turnContext(caller.id)
          if ((yield* store.lineageDepth(caller.id)) >= 2)
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                "This thread is already two levels below the user's thread, so it can't create threads. Do the work here, or say in your final message what should be delegated."
              )
            )
          if (turn.createdCount >= 5)
            return yield* Effect.fail(
              new StoreError('invalid_params', 'Maximum 5 threads per turn')
            )
          const catalog = models()
          if (!catalog)
            return yield* Effect.fail(
              new StoreError('invalid_params', 'Provider discovery is still running; retry shortly')
            )
          const matches = input.model ? matchingModels(catalog, input.model) : []
          const provider =
            input.provider ?? (matches.length === 1 ? matches[0]!.provider : identity.provider)
          const available = catalog.filter((m) => m.provider === provider)
          if (!available.length)
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `${providerNames[provider]} isn't available here. Available: ${[...new Set(catalog.map((m) => providerNames[m.provider]))].join(', ') || 'none'}`
              )
            )
          const selected = input.model
            ? matches.filter((m) => m.provider === provider)
            : provider === caller.provider
              ? [findProviderModel(available, provider, caller.model)].filter(
                  (m) => m !== undefined
                )
              : []
          if (input.model && selected.length !== 1)
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `Unknown or ambiguous model ${input.model}. Available: ${modelOptions(catalog)}`
              )
            )
          const model = selected[0]?.id
          if (input.effort && selected[0] && !selected[0].efforts.includes(input.effort))
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `Unsupported effort for ${selected[0].name}. Choose: ${selected[0].efforts.join(', ') || 'none'}`
              )
            )
          const callerMode = (yield* store.getPermissionMode(caller.id)) ?? 'auto'
          const mode =
            selected[0]?.autoMode === false ||
            findProviderModel(catalog, caller.provider, caller.model)?.autoMode === false
              ? 'auto'
              : callerMode
          if (accessLevel({ provider, model }, mode) > accessLevel(caller, callerMode))
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                'This thread asks before acting, so its threads must too: leave out model and provider to use your own model'
              )
            )
          const id = newId()
          yield* store.createThread(projectId, id)
          yield* store.setThreadEnvironment(id, baseCommit)
          yield* store.markAgentThread(id, caller.id, input.notify)
          yield* store.setThreadProviderIfAbsent(id, provider)
          yield* store.setThreadLoadout(id, { model, effort: input.effort })
          yield* store.setPermissionMode(id, mode)
          if (input.title) yield* store.setThreadTitle(id, input.title)
          yield* store.enqueue(id, {
            id: newId(),
            text: input.prompt,
            from: { threadId: caller.id, title: caller.title },
            hop: turn.hop + 1,
            createdAt: Date.now(),
          })
          yield* store.countCreation(turn.turnId)
          const response = { threadId: id, link: `jetty://threads/${id}` }
          if (input.requestId)
            yield* store.saveRequest(caller.id, input.requestId, 'create_thread', response)
          return response
        })
      )
      return Effect.gen(function* () {
        const caller = yield* accessible(identity, identity.threadId)
        if (input.requestId) {
          const previous = yield* store.getRequest(caller.id, input.requestId, 'create_thread')
          if (previous) return previous
        }
        const target = yield* matchProject(
          yield* store.listProjects(),
          input.project,
          caller.projectId
        )
        projectId = target.id
        const sameProject = target.id === caller.projectId
        const environment =
          input.environment ??
          (sameProject
            ? caller.environment
            : worktrees
              ? yield* Effect.promise(() => worktrees.defaultEnvironment(target.path))
              : 'worktree')
        if (environment === 'local') return yield* orch.withAdmission(caller.id, create)
        if (!worktrees) return yield* Effect.fail(new StoreError('not_found', 'Project not found'))
        const fromWorktree = sameProject && caller.environment === 'worktree'
        const cwd = fromWorktree
          ? yield* Effect.promise(() => worktrees.root(caller.id))
          : target.path
        baseCommit = yield* Effect.tryPromise({
          try: () => worktrees.resolveRef(cwd, input.ref ?? (fromWorktree ? 'HEAD' : undefined)),
          catch: (error) =>
            new StoreError(
              'invalid_params',
              error instanceof Error ? error.message : String(error)
            ),
        })
        return yield* orch.withAdmission(caller.id, create)
      })
    }

    function sendMessage(identity: McpIdentity, input: z.infer<typeof sendInput>) {
      return Effect.gen(function* () {
        const response = yield* store.transaction(
          Effect.gen(function* () {
            const target = yield* accessible(identity, input.threadId)
            if (input.requestId) {
              const previous = yield* store.getRequest(
                identity.threadId,
                input.requestId,
                'send_message'
              )
              if (previous)
                return {
                  ...previous,
                  title: target.title,
                  duplicate: true,
                  busy: false,
                  ownChild: false,
                  resumed: false,
                }
            }
            const caller = yield* store.requireThread(identity.threadId)
            if (
              accessLevel(target, yield* store.getPermissionMode(target.id)) >
              accessLevel(caller, yield* store.getPermissionMode(caller.id))
            )
              return yield* Effect.fail(
                new StoreError(
                  'invalid_params',
                  'Cannot send_message to a thread with a higher access mode than the sender'
                )
              )
            const turn = yield* store.turnContext(caller.id)
            const ownChild = target.parentThreadId === caller.id
            // A parent's message restarts a child it stopped, in the transaction that queues it, so
            // a crash can't keep one without the other. One the restart guard holds waits for the
            // user's Resume.
            const resumed =
              ownChild &&
              target.queuePaused &&
              !heldByRestarts((yield* store.getThreadState(target.id)).items)
            const messageId = newId()
            yield* store.enqueue(target.id, {
              id: messageId,
              text: input.text,
              from: { threadId: caller.id, title: caller.title },
              hop: turn.hop + 1,
              createdAt: Date.now(),
            })
            if (resumed) yield* store.setQueuePaused(target.id, false)
            const response = { threadId: target.id, title: target.title, messageId }
            if (input.requestId)
              yield* store.saveRequest(caller.id, input.requestId, 'send_message', response)
            return {
              ...response,
              duplicate: false,
              busy: ['starting', 'running', 'awaiting_approval'].includes(target.status),
              ownChild,
              resumed,
            }
          })
        )
        if (response.resumed) yield* orch.queueResumed(response.threadId)
        let delivery = 'queued'
        if (input.steer && !response.duplicate && response.messageId) {
          const sent = yield* orch.sendQueuedNow(response.threadId, response.messageId, false).pipe(
            Effect.as(true),
            Effect.catchCause(() => Effect.succeed(false))
          )
          if (sent) delivery = 'delivered'
        }
        const detail =
          delivery === 'delivered'
            ? response.busy
              ? 'Steered into the running turn.'
              : 'Delivered in a new turn.'
            : (yield* store.isQueuePaused(response.threadId))
              ? 'Queued, but the thread is paused, so this waits until the user resumes it.'
              : response.busy
                ? 'Queued; it reads this when its current turn ends.'
                : 'Queued; it starts on this within a second or so.'
        return {
          threadId: response.threadId,
          title: response.title,
          messageId: response.messageId,
          delivery,
          detail: response.ownChild
            ? `${detail} Its report reaches you only once your turn ends, so end it now instead of waiting.`
            : detail,
        }
      })
    }

    async function register(server: McpServer, identity: McpIdentity) {
      const parentId = (await run(accessible(identity, identity.threadId))).parentThreadId
      function invoke<A>(effect: Effect.Effect<A, Error>) {
        return run(
          effect.pipe(
            Effect.map(result),
            Effect.catch((error) =>
              Effect.succeed({
                content: [
                  {
                    type: 'text' as const,
                    text:
                      error instanceof StoreError
                        ? error.message
                        : `Jetty tool failed: ${error.message}`,
                  },
                ],
                isError: true,
              })
            )
          )
        ).catch((error: unknown) => ({
          content: [
            {
              type: 'text' as const,
              text: `Jetty tool failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }))
      }
      server.registerTool(
        'list_threads',
        {
          description:
            "List threads across projects (archived ones aren't included) with their status, model, parent and project. Your project first. Pass project to filter by name.",
          inputSchema: {
            project: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe('Filter by project name (case-insensitive).'),
          },
        },
        ({ project }) =>
          invoke(
            Effect.gen(function* () {
              const caller = yield* accessible(identity, identity.threadId)
              const titles = new Map(
                (yield* store.listProjects()).map((item) => [item.id, item.title])
              )
              const key = project?.toLowerCase()
              const listed = (yield* store.listThreads()).filter(
                (t) => !t.archived && (!key || titles.get(t.projectId)?.toLowerCase() === key)
              )
              const own = listed.filter((t) => t.projectId === caller.projectId)
              const rest = listed.filter((t) => t.projectId !== caller.projectId)
              return [...own, ...rest].map((t) => ({
                id: t.id,
                title: t.title,
                project: titles.get(t.projectId) ?? t.projectId,
                status: t.status,
                provider: t.provider,
                model: t.model,
                parentThreadId: t.parentThreadId,
                createdBy: t.createdBy ?? 'user',
              }))
            })
          )
      )
      server.registerTool(
        'read_thread',
        {
          description:
            "Read a thread's latest 20 user and assistant messages, each cut at 4,000 characters (marked truncated). Pass after to read on from an earlier message, or messageId to get one message in full.",
          inputSchema: {
            threadId: z.string(),
            after: z
              .string()
              .optional()
              .describe('A message id from an earlier read; returns the messages after it.'),
            messageId: z.string().optional().describe('Returns that one message in full.'),
          },
        },
        (input) =>
          invoke(
            Effect.gen(function* () {
              const thread = yield* accessible(identity, input.threadId)
              const state = yield* store.getThreadState(input.threadId)
              const messages = state.items.filter(
                (i) => i.kind === 'user_message' || i.kind === 'assistant_message'
              )
              const cursor = input.messageId ?? input.after
              const index = cursor ? messages.findIndex((i) => i.id === cursor) : -1
              if (cursor && index < 0)
                return yield* Effect.fail(
                  new StoreError('invalid_params', `No message ${cursor} in this thread`)
                )
              const page = input.messageId
                ? [messages[index]!]
                : input.after
                  ? messages.slice(index + 1, index + 21)
                  : messages.slice(-20)
              const cap = input.messageId ? Infinity : 4000
              return {
                title: thread.title,
                messages: page.map((i) => ({
                  id: i.id,
                  role: i.kind === 'user_message' ? 'user' : 'assistant',
                  text: relayedMessage(
                    (i.kind === 'user_message' && i.from) || {
                      threadId: thread.id,
                      title: thread.title,
                    },
                    i.text.slice(0, cap)
                  ),
                  truncated: i.text.length > cap,
                })),
                after: page.at(-1)?.id ?? input.after ?? null,
              }
            })
          )
      )
      server.registerTool(
        'list_models',
        {
          description:
            'List live Jetty providers, model IDs and names, and supported effort levels for create_thread.',
          inputSchema: {},
        },
        () =>
          invoke(
            Effect.gen(function* () {
              const catalog = models()
              if (!catalog)
                return yield* Effect.fail(
                  new StoreError(
                    'invalid_params',
                    'Provider discovery is still running; retry shortly'
                  )
                )
              return catalog.map(({ provider, id, name, efforts, defaultEffort }) => ({
                provider,
                id,
                name,
                efforts,
                defaultEffort,
              }))
            })
          )
      )
      server.registerTool(
        'create_thread',
        {
          description:
            "Create a child thread and start it on your prompt. This project unless you pass project (a name). It uses your environment, provider and model unless you set them; in another project, that project's environment default and worktree base. list_models has the options. Up to 5 per turn, and nesting stops two levels below the user's thread.",
          inputSchema: createInput,
        },
        (input) => invoke(createThread(identity, input))
      )
      server.registerTool(
        'send_message',
        {
          description:
            'Send a message to another thread. An idle thread starts on it right away; a busy one reads it after its current turn, unless you steer.',
          inputSchema: sendInput,
        },
        (input) => invoke(sendMessage(identity, input))
      )
      if (parentId)
        server.registerTool(
          'ask_parent',
          {
            description:
              'Ask the thread that created yours a question, such as a decision you need from it. Jetty sends it when your turn ends, and its answer arrives as your next message.',
            inputSchema: { question: text },
          },
          ({ question }) =>
            invoke(
              Effect.gen(function* () {
                const parent = yield* accessible(identity, parentId)
                yield* store.askParent(identity.threadId, question)
                return {
                  threadId: parent.id,
                  title: parent.title,
                  detail:
                    'Jetty sends your question when this turn ends, so end your turn now. The answer arrives as your next message.',
                }
              })
            )
        )
      server.registerTool(
        'mark_ready_for_review',
        {
          description:
            "Show this thread as Ready for review in the user's sidebar until they open it. In a child thread this does nothing: your final message goes to your creator instead.",
          inputSchema: {},
        },
        () =>
          invoke(
            orch.markReadyForReview(identity.threadId).pipe(
              Effect.map((thread) => ({
                threadId: thread.id,
                readyForReview: thread.readyForReview === true,
                ...(thread.parentThreadId ? { reportsTo: thread.parentThreadId } : {}),
              }))
            )
          )
      )
      server.registerTool(
        'link_pull_request',
        {
          description:
            "Link a GitHub pull request to this thread so the user can follow it in Jetty. PRs you create or view with `gh pr create` or `gh pr view` link themselves; call this for one opened another way, or one you take over. Accepts a PR URL, or a number in this project's GitHub repo.",
          inputSchema: { pullRequest: z.string().trim().min(1).max(500) },
        },
        ({ pullRequest }) =>
          invoke(
            pullRequestLinks.link(identity.threadId, pullRequest).pipe(
              Effect.map(({ ref }) => ({
                linked: `${ref.repo}#${ref.number}`,
                url: `https://github.com/${ref.repo}/pull/${ref.number}`,
              }))
            )
          )
      )
      server.registerTool(
        'archive_thread',
        {
          description:
            "Archive a thread and everything under it. Not this thread, and not one above it. A thread that isn't under yours has to be idle, and so does everything under it. Work stops with no report back, worktree folders are removed and branches kept, so every worktree in the tree must be clean. The user can restore them.",
          inputSchema: { threadId: z.string() },
        },
        ({ threadId }) =>
          invoke(
            Effect.gen(function* () {
              const target = yield* archiveTarget(identity, threadId)
              yield* archiveThread(threadId).pipe(
                Effect.mapError((error) => new StoreError(error.code, error.message))
              )
              return { threadId, title: target.title, archived: true }
            })
          )
      )
      server.registerTool(
        'stop_thread',
        {
          description:
            'Stop one of your children: its turn and background tasks end, with no report back. Your next message to it starts it again. Safe to repeat.',
          inputSchema: { threadId: z.string() },
        },
        ({ threadId }) =>
          invoke(
            Effect.gen(function* () {
              yield* ownChild(identity, threadId)
              yield* orch.stopThread(threadId)
              return { threadId, stopped: true }
            })
          )
      )
      const media = await run(
        Effect.gen(function* () {
          const caller = yield* accessible(identity, identity.threadId)
          const project = yield* store.getProject(caller.projectId)
          if (!project) return yield* Effect.fail(new StoreError('not_found', 'Project not found'))
          const host = {
            attachments,
            resolveAttachment: (id: string, kind: 'image' | 'video') =>
              Effect.gen(function* () {
                const found = yield* store.reserveAttachment(caller.id, id, kind)
                if (yield* attachments.resolve(id)) return found
                return yield* Effect.fail(
                  new StoreError('not_found', `No ${kind} attachment ${id} in this project`)
                )
              }),
            projectPath: worktrees
              ? yield* Effect.promise(() => worktrees.root(caller.id))
              : project.path,
            turnId: () => orch.currentTurn(caller.id) ?? '',
            emit: (
              event: Parameters<typeof orch.emitMedia>[2],
              turnId: string,
              onCommit: Effect.Effect<void>
            ) => orch.emitMedia(caller.id, turnId, event, onCommit),
          }
          return [yield* createSendImagesTool(host), yield* createSendVideoTool(host)] as const
        })
      )
      const [images, video] = media
      server.registerTool(
        images.name,
        { description: images.description, inputSchema: images.inputSchema },
        images.handler
      )
      server.registerTool(
        video.name,
        { description: video.description, inputSchema: video.inputSchema },
        video.handler
      )
    }

    async function handle(request: Request): Promise<Response> {
      const identity = sessions.authenticate(request.headers.get('authorization'))
      if (!identity) return new Response('Unauthorized', { status: 401 })
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
      const server = new McpServer({ name: 'jetty', version: '1.0.0' })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      try {
        await register(server, identity)
        await server.connect(transport)
        return await transport.handleRequest(request)
      } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Thread unavailable', {
          status: 404,
        })
      } finally {
        await server.close()
      }
    }
    return Object.assign(handle, { register })
  })
}
