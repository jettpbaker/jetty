import type { ServerWebSocket } from 'bun'

import {
  methods,
  RequestMessage,
  type MethodName,
  type ParamsOf,
  type ResponseMessage,
  type Usage,
} from '@jetty/shared/wire'
import { Effect, Result, Schema } from 'effect'

import type { Hub, ConnData } from './hub'
import type { Orchestrator } from './orchestrator'
import type { Store } from './store'

import { computeThreadDiff } from './diff'
import { browse } from './fs-browse'
import { searchFiles } from './fs-search'
import { slog } from './log'
import { storeEffect } from './orchestrator'
import { listSkills } from './skills'
import { StoreError } from './store'

export type WsServer = {
  stop(): void
  handlers: {
    open(ws: ServerWebSocket<ConnData>): void
    message(ws: ServerWebSocket<ConnData>, raw: string | Buffer): void
    close(ws: ServerWebSocket<ConnData>): void
  }
}

export function createWs(
  store: Store,
  orch: Orchestrator,
  hub: Hub,
  run: (effect: Effect.Effect<void>) => Promise<void>,
  getUsage: () => Usage | null = () => null
): WsServer {
  function respond(ws: ServerWebSocket<ConnData>, msg: ResponseMessage) {
    hub.send(ws, msg)
  }

  function dispatch(ws: ServerWebSocket<ConnData>, method: MethodName, params: unknown) {
    return Effect.gen(function* () {
      const schema = methods[method]
      const parsed = Schema.decodeUnknownResult(schema.params)(params)
      if (Result.isFailure(parsed)) {
        return yield* Effect.fail(new StoreError('invalid_params', parsed.failure.message))
      }

      switch (method) {
        case 'chrome.subscribe': {
          hub.subscribeChrome(ws)
          const usage = getUsage()
          hub.send(ws, {
            sub: 'chrome',
            data: {
              type: 'snapshot',
              projects: yield* storeEffect(() => store.listProjects()),
              threads: yield* storeEffect(() => store.listThreads()),
              ...(usage ? { usage } : {}),
            },
          })
          return null
        }
        case 'project.create': {
          const p = parsed.success as ParamsOf<'project.create'>
          const project = yield* storeEffect(() => store.createProject(p.path))
          hub.pushChrome({ type: 'project.upserted', project })
          return { project }
        }
        case 'fs.browse': {
          const p = parsed.success as ParamsOf<'fs.browse'>
          return yield* storeEffect(() => browse(p.partialPath))
        }
        case 'fs.search': {
          const p = parsed.success as ParamsOf<'fs.search'>
          const project = yield* storeEffect(() => store.getProject(p.projectId!))
          if (!project)
            return yield* Effect.fail(
              new StoreError('not_found', `Project ${p.projectId} not found`)
            )
          const files = yield* Effect.tryPromise(() => searchFiles(project.path, p.query, p.limit))
          return { files }
        }
        case 'skills.list': {
          const p = parsed.success as ParamsOf<'skills.list'>
          if (!p.projectId) return yield* storeEffect(() => ({ skills: listSkills({}) }))
          const project = yield* storeEffect(() => store.getProject(p.projectId!))
          if (!project)
            return yield* Effect.fail(
              new StoreError('not_found', `Project ${p.projectId} not found`)
            )
          return yield* storeEffect(() => ({ skills: listSkills({ projectPath: project.path }) }))
        }
        case 'thread.create': {
          const p = parsed.success as ParamsOf<'thread.create'>
          const thread = yield* storeEffect(() => store.createThread(p.projectId, p.id))
          hub.pushChrome({ type: 'thread.upserted', thread })
          return { thread }
        }
        case 'thread.archive': {
          const p = parsed.success as ParamsOf<'thread.archive'>
          const thread = yield* storeEffect(() => store.archiveThread(p.threadId))
          hub.pushChrome({ type: 'thread.upserted', thread })
          return null
        }
        case 'thread.diff': {
          const p = parsed.success as ParamsOf<'thread.diff'>
          return yield* Effect.tryPromise({
            try: () => computeThreadDiff(store, p.threadId),
            catch: (error) =>
              error instanceof StoreError ? error : new StoreError('internal', String(error)),
          })
        }
        case 'thread.subscribe': {
          const p = parsed.success as ParamsOf<'thread.subscribe'>
          const thread = yield* storeEffect(() => store.getThread(p.threadId))
          if (!thread)
            return yield* Effect.fail(new StoreError('not_found', `Thread ${p.threadId} not found`))
          hub.subscribeThread(ws, p.threadId)
          const state = yield* storeEffect(() => store.getThreadState(p.threadId))
          if (p.afterSeq !== undefined) {
            for (const ev of yield* storeEffect(() =>
              store.getEventsAfter(p.threadId, p.afterSeq!)
            )) {
              hub.send(ws, {
                sub: 'thread',
                threadId: p.threadId,
                seq: ev.seq,
                ts: ev.ts,
                event: ev.event,
              })
            }
            return { seq: state.lastSeq }
          }
          return { snapshot: state, seq: state.lastSeq }
        }
        case 'thread.unsubscribe': {
          const p = parsed.success as ParamsOf<'thread.unsubscribe'>
          hub.unsubscribeThread(ws, p.threadId)
          return null
        }
        case 'turn.start': {
          const p = parsed.success as ParamsOf<'turn.start'>
          slog(
            'ws',
            `turn.start thread=${p.threadId} chars=${p.text.length} model=${p.model ?? '-'}`
          )
          return yield* orch.startTurnEffect({
            threadId: p.threadId,
            text: p.text,
            attachments: p.attachments,
            model: p.model,
            effort: p.effort,
            permissionMode: p.permissionMode,
          })
        }
        case 'turn.interrupt': {
          const p = parsed.success as ParamsOf<'turn.interrupt'>
          yield* orch.interrupt(p.threadId)
          return null
        }
        case 'approval.respond': {
          const p = parsed.success as ParamsOf<'approval.respond'>
          yield* orch.respondApproval(
            p.threadId,
            p.itemId,
            p.decision,
            p.message,
            p.updatedPermissions ? [...p.updatedPermissions] : undefined
          )
          return null
        }
        case 'question.respond': {
          const p = parsed.success as ParamsOf<'question.respond'>
          yield* orch.respondQuestion(p.threadId, p.itemId, p.answers)
          return null
        }
        default: {
          const _exhaustive: never = method
          return yield* Effect.fail(
            new StoreError('unknown_method', `Unknown method: ${_exhaustive}`)
          )
        }
      }
    })
  }

  let accepting = true
  return {
    stop() {
      accepting = false
    },
    handlers: {
      open(ws) {
        ws.data.chrome = false
        ws.data.threads = new Set()
      },

      message(ws, raw) {
        if (!accepting) return
        const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
        let json: unknown
        try {
          json = JSON.parse(text)
        } catch {
          respond(ws, {
            id: '',
            ok: false,
            error: { code: 'invalid_request', message: 'Message is not valid JSON' },
          })
          return
        }

        const req = Schema.decodeUnknownResult(RequestMessage)(json)
        if (Result.isFailure(req)) {
          const id =
            typeof json === 'object' &&
            json !== null &&
            'id' in json &&
            typeof (json as { id: unknown }).id === 'string'
              ? (json as { id: string }).id
              : ''
          respond(ws, {
            id,
            ok: false,
            error: { code: 'invalid_request', message: 'Invalid request message' },
          })
          return
        }

        const { id, method, params } = req.success
        void run(
          dispatch(ws, method, params).pipe(
            Effect.match({
              onSuccess: (result) => respond(ws, { id, ok: true, result }),
              onFailure: (error) =>
                respond(ws, {
                  id,
                  ok: false,
                  error: {
                    code: error instanceof StoreError ? error.code : 'internal',
                    message: error instanceof Error ? error.message : String(error),
                  },
                }),
            })
          )
        ).catch(() => {})
      },

      close(ws) {
        hub.dropConnection(ws)
      },
    },
  }
}
