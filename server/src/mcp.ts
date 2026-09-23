import { newId, type ProviderModel } from '@jetty/shared/wire'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Effect, Path, Scope } from 'effect'
import { z } from 'zod'

import type { Attachments } from './attachments'
import type { McpIdentity, McpSessions } from './mcp-sessions'
import type { Orchestrator } from './orchestrator'
import type { Store } from './store'

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

function matchingModels(catalog: readonly ProviderModel[], name: string) {
  const key = modelKey(name)
  const exact = catalog.filter((m) => modelKey(m.id) === key || modelKey(m.name) === key)
  if (exact.length) return exact
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
const requestId = z.string().min(1).max(200).optional()
const createInput = z.object({
  prompt: text,
  title: z.string().trim().min(1).max(200).optional(),
  provider: z.enum(['claude', 'codex', 'grok']).optional(),
  model: z.string().min(1).optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  notify: z.boolean().default(true),
  requestId,
})
const sendInput = z.object({
  threadId: z.string(),
  text,
  steer: z.boolean().default(false),
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
  models: () => readonly ProviderModel[] | null
) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<Path.Path | Scope.Scope>()
    const run = Effect.runPromiseWith(context)

    function accessible(identity: McpIdentity, targetId: string) {
      return Effect.gen(function* () {
        const caller = yield* store.requireThread(identity.threadId)
        const target = yield* store.requireThread(targetId)
        if (caller.archived || target.archived || caller.projectId !== target.projectId)
          return yield* Effect.fail(
            new StoreError('not_found', 'Thread not found in caller project')
          )
        return target
      })
    }

    function accessLevel(thread: { provider?: string; model?: string }, mode?: string) {
      if (
        models()?.some(
          (m) => m.provider === thread.provider && m.id === thread.model && m.autoMode === false
        )
      )
        return 0
      return mode === 'full_access' ? 2 : 1
    }

    function createThread(identity: McpIdentity, input: z.infer<typeof createInput>) {
      return store.transaction(
        Effect.gen(function* () {
          const caller = yield* accessible(identity, identity.threadId)
          if (input.requestId) {
            const previous = yield* store.getRequest(caller.id, input.requestId, 'create_thread')
            if (previous) return previous
          }
          const turn = yield* store.turnContext(caller.id)
          if ((yield* store.lineageDepth(caller.id)) >= 2)
            return yield* Effect.fail(
              new StoreError('invalid_params', 'Maximum lineage depth is 2')
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
            : available.filter((m) => m.id === caller.model && provider === caller.provider)
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
          const id = newId()
          yield* store.createThread(caller.projectId, id)
          yield* store.markAgentThread(id, caller.id, input.notify)
          yield* store.setThreadProviderIfAbsent(id, provider)
          yield* store.setThreadLoadout(id, { model, effort: input.effort })
          const mode = (yield* store.getPermissionMode(caller.id)) ?? 'auto'
          yield* store.setPermissionMode(
            id,
            selected[0]?.autoMode === false ||
              models()?.find((m) => m.provider === caller.provider && m.id === caller.model)
                ?.autoMode === false
              ? 'auto'
              : mode
          )
          if (input.title) yield* store.setThreadTitle(id, input.title)
          yield* store.enqueue(id, {
            id: newId(),
            text: input.prompt,
            from: { threadId: caller.id, title: caller.title },
            hop: turn.hop + 1,
            createdAt: Date.now(),
          })
          yield* store.countCreation(turn.turnId)
          const response = { threadId: id }
          if (input.requestId)
            yield* store.saveRequest(caller.id, input.requestId, 'create_thread', response)
          return response
        })
      )
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
                return { ...previous, title: target.title, duplicate: true, busy: false }
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
            const messageId = newId()
            yield* store.enqueue(target.id, {
              id: messageId,
              text: input.text,
              from: { threadId: caller.id, title: caller.title },
              hop: turn.hop + 1,
              createdAt: Date.now(),
            })
            const response = { threadId: target.id, title: target.title, messageId }
            if (input.requestId)
              yield* store.saveRequest(caller.id, input.requestId, 'send_message', response)
            return {
              ...response,
              duplicate: false,
              busy: ['starting', 'running', 'awaiting_approval'].includes(target.status),
            }
          })
        )
        let delivery = 'queued'
        if (input.steer && !response.duplicate && response.messageId) {
          const sent = yield* orch.sendQueuedNow(response.threadId, response.messageId, false).pipe(
            Effect.as(true),
            Effect.catchCause(() => Effect.succeed(false))
          )
          if (sent) delivery = 'delivered'
        }
        return {
          threadId: response.threadId,
          title: response.title,
          messageId: response.messageId,
          delivery,
          detail:
            delivery === 'delivered'
              ? response.busy
                ? 'Steered into the running turn.'
                : 'Delivered in a new turn.'
              : 'Queued; the thread will read this when its current turn ends.',
        }
      })
    }

    return async function handle(request: Request): Promise<Response> {
      const identity = sessions.authenticate(request.headers.get('authorization'))
      if (!identity) return new Response('Unauthorized', { status: 401 })
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
      const callerExists = await run(
        accessible(identity, identity.threadId).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false))
        )
      )
      if (!callerExists) return new Response('Caller thread unavailable', { status: 404 })
      const server = new McpServer({ name: 'jetty', version: '1.0.0' })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      function invoke<A>(effect: Effect.Effect<A, Error>) {
        return run(
          effect.pipe(
            Effect.map(result),
            Effect.catch((error) =>
              Effect.succeed({
                content: [
                  {
                    type: 'text' as const,
                    text: error instanceof StoreError ? error.message : 'Jetty tool failed',
                  },
                ],
                isError: true,
              })
            )
          )
        ).catch(() => ({
          content: [
            {
              type: 'text' as const,
              text: 'Jetty tool failed; check the arguments and thread state.',
            },
          ],
          isError: true,
        }))
      }
      server.registerTool(
        'list_threads',
        { description: 'List active, unarchived threads in your project.', inputSchema: {} },
        () =>
          invoke(
            Effect.gen(function* () {
              const caller = yield* accessible(identity, identity.threadId)
              return (yield* store.listThreads())
                .filter((t) => t.projectId === caller.projectId && !t.archived)
                .map((t) => ({
                  id: t.id,
                  title: t.title,
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
            'Read recent user and assistant messages, up to 20 messages of 4000 characters each. Pass the returned after cursor to read newer messages.',
          inputSchema: { threadId: z.string(), after: z.string().optional() },
        },
        (input) =>
          invoke(
            Effect.gen(function* () {
              const thread = yield* accessible(identity, input.threadId)
              const state = yield* store.getThreadState(input.threadId)
              const messages = state.items.filter(
                (i) => i.kind === 'user_message' || i.kind === 'assistant_message'
              )
              const index = input.after ? messages.findIndex((i) => i.id === input.after) : -1
              if (input.after && index < 0)
                return yield* Effect.fail(new StoreError('invalid_params', 'Unknown after cursor'))
              const page = input.after ? messages.slice(index + 1, index + 21) : messages.slice(-20)
              return {
                title: thread.title,
                messages: page.map((i) => ({
                  id: i.id,
                  role: i.kind === 'user_message' ? 'user' : 'assistant',
                  text: i.text.slice(0, 4000),
                  truncated: i.text.length > 4000,
                  ...(i.kind === 'user_message' && i.from ? { from: i.from } : {}),
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
        () => invoke(Effect.succeed(models() ?? []))
      )
      server.registerTool(
        'create_thread',
        {
          description:
            'Delegate work to an independent Jetty agent in this project. The new thread works on its prompt in parallel; its result returns automatically as a ready for review message (notify defaults true). Choose provider/model/effort from list_models; model accepts an ID, display name, or unique short name. Reuse requestId to retry safely.',
          inputSchema: createInput,
        },
        (input) => invoke(createThread(identity, input))
      )
      server.registerTool(
        'send_message',
        {
          description:
            'Message another Jetty agent thread. Default: queue behind its current turn, so it cannot answer until that turn ends. Use steer=true for urgent corrections or status checks during a running turn; the result says whether it was steered or queued. Reuse requestId to retry safely.',
          inputSchema: sendInput,
        },
        (input) => invoke(sendMessage(identity, input))
      )
      try {
        const media = await run(
          Effect.gen(function* () {
            const caller = yield* accessible(identity, identity.threadId)
            const project = yield* store.getProject(caller.projectId)
            if (!project)
              return yield* Effect.fail(new StoreError('not_found', 'Project not found'))
            const host = {
              attachments,
              resolveAttachment: (id: string, kind: 'image' | 'video') =>
                Effect.gen(function* () {
                  const found = yield* store.resolveAttachment(caller.projectId, id, kind)
                  if (yield* attachments.resolve(id)) return found
                  return yield* Effect.fail(
                    new StoreError('not_found', 'Attachment not found in caller project')
                  )
                }),
              projectPath: project.path,
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
  })
}
