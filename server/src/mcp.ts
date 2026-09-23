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
          const provider = input.provider ?? identity.provider
          const model = input.model ?? (provider === caller.provider ? caller.model : undefined)
          const available = models()?.filter((m) => m.provider === provider)
          if (model && available?.length && !available.some((m) => m.id === model))
            return yield* Effect.fail(
              new StoreError('invalid_params', 'Unknown model for provider')
            )
          const selected = available?.find((m) => m.id === model)
          if (input.effort && selected && !selected.efforts.includes(input.effort))
            return yield* Effect.fail(new StoreError('invalid_params', 'Unsupported model effort'))
          const id = newId()
          yield* store.createThread(caller.projectId, id)
          yield* store.markAgentThread(id, caller.id, input.notify)
          yield* store.setThreadProviderIfAbsent(id, provider)
          yield* store.setThreadLoadout(id, { model, effort: input.effort })
          const mode = yield* store.getPermissionMode(caller.id)
          yield* store.setPermissionMode(
            id,
            selected?.autoMode === false ||
              models()?.find((m) => m.provider === caller.provider && m.id === caller.model)
                ?.autoMode === false
              ? undefined
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
              if (previous) return { ...previous, duplicate: true }
            }
            const caller = yield* store.requireThread(identity.threadId)
            const turn = yield* store.turnContext(caller.id)
            const messageId = newId()
            yield* store.enqueue(target.id, {
              id: messageId,
              text: input.text,
              from: { threadId: caller.id, title: caller.title },
              hop: turn.hop + 1,
              createdAt: Date.now(),
            })
            const response = { threadId: target.id, messageId }
            if (input.requestId)
              yield* store.saveRequest(caller.id, input.requestId, 'send_message', response)
            return { ...response, duplicate: false }
          })
        )
        if (input.steer && !response.duplicate && response.messageId)
          yield* orch.sendQueuedNow(response.threadId, response.messageId)
        return { threadId: response.threadId, messageId: response.messageId }
      })
    }

    return async function handle(request: Request): Promise<Response> {
      const identity = sessions.authenticate(request.headers.get('authorization'))
      if (!identity) return new Response('Unauthorized', { status: 401 })
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
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
              yield* accessible(identity, input.threadId)
              const state = yield* store.getThreadState(input.threadId)
              const messages = state.items.filter(
                (i) => i.kind === 'user_message' || i.kind === 'assistant_message'
              )
              const index = input.after ? messages.findIndex((i) => i.id === input.after) : -1
              if (input.after && index < 0)
                return yield* Effect.fail(new StoreError('invalid_params', 'Unknown after cursor'))
              const page = input.after ? messages.slice(index + 1, index + 21) : messages.slice(-20)
              return {
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
        'create_thread',
        {
          description:
            'Create and start an independent top-level thread in your project with only this prompt. Optional provider/model can differ from yours. Notify defaults to true: completion is sent back to this thread. Reuse requestId to retry safely.',
          inputSchema: createInput,
        },
        (input) => invoke(createThread(identity, input))
      )
      server.registerTool(
        'send_message',
        {
          description:
            'Send a message to another thread in your project. Queues in order if busy, starts it if idle. Use steer=true only to redirect its current turn. Reuse requestId to retry safely.',
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
      } finally {
        await server.close()
      }
    }
  })
}
