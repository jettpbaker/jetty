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

import { GitDiff } from './diff'
import { FileBrowser } from './fs-browse'
import { FileSearch } from './fs-search'
import { slog } from './log'
import { Skills } from './skills'
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
) {
  return Effect.gen(function* () {
    const browser = yield* FileBrowser
    const search = yield* FileSearch
    const skills = yield* Skills
    const diff = yield* GitDiff
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
            const projects = yield* store.listProjects()
            const threads = yield* store.listThreads()
            const usage = getUsage()
            hub.subscribeChrome(ws)
            hub.send(ws, {
              sub: 'chrome',
              data: {
                type: 'snapshot',
                projects,
                threads,
                ...(usage ? { usage } : {}),
              },
            })
            return null
          }
          case 'project.create': {
            const p = parsed.success as ParamsOf<'project.create'>
            const project = yield* store.createProject(p.path)
            hub.pushChrome({ type: 'project.upserted', project })
            return { project }
          }
          case 'fs.browse': {
            const p = parsed.success as ParamsOf<'fs.browse'>
            return yield* browser.browse(p.partialPath)
          }
          case 'fs.search': {
            const p = parsed.success as ParamsOf<'fs.search'>
            const project = yield* store.getProject(p.projectId!)
            if (!project)
              return yield* Effect.fail(
                new StoreError('not_found', `Project ${p.projectId} not found`)
              )
            const files = yield* search.searchFiles(project.path, p.query, p.limit)
            return { files }
          }
          case 'skills.list': {
            const p = parsed.success as ParamsOf<'skills.list'>
            if (!p.projectId) return { skills: yield* skills.listSkills() }
            const project = yield* store.getProject(p.projectId!)
            if (!project)
              return yield* Effect.fail(
                new StoreError('not_found', `Project ${p.projectId} not found`)
              )
            return { skills: yield* skills.listSkills({ projectPath: project.path }) }
          }
          case 'thread.create': {
            const p = parsed.success as ParamsOf<'thread.create'>
            const thread = yield* store.createThread(p.projectId, p.id)
            hub.pushChrome({ type: 'thread.upserted', thread })
            return { thread }
          }
          case 'thread.archive': {
            const p = parsed.success as ParamsOf<'thread.archive'>
            const thread = yield* store.archiveThread(p.threadId)
            hub.pushChrome({ type: 'thread.upserted', thread })
            return null
          }
          case 'thread.diff': {
            const p = parsed.success as ParamsOf<'thread.diff'>
            const thread = yield* store.getThread(p.threadId)
            const project = thread && (yield* store.getProject(thread.projectId))
            if (!project) return { diff: '' }
            return yield* diff.computeThreadDiff(project.path)
          }
          case 'thread.subscribe': {
            const p = parsed.success as ParamsOf<'thread.subscribe'>
            const thread = yield* store.getThread(p.threadId)
            if (!thread)
              return yield* Effect.fail(
                new StoreError('not_found', `Thread ${p.threadId} not found`)
              )
            const state = yield* store.getThreadState(p.threadId)
            if (p.afterSeq !== undefined) {
              for (const ev of yield* store.getEventsAfter(p.threadId, p.afterSeq!)) {
                hub.send(ws, {
                  sub: 'thread',
                  threadId: p.threadId,
                  seq: ev.seq,
                  ts: ev.ts,
                  event: ev.event,
                })
              }
              hub.subscribeThread(ws, p.threadId)
              return { seq: state.lastSeq }
            }
            hub.subscribeThread(ws, p.threadId)
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
          let response = dispatch(ws, method, params).pipe(
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
          if (method === 'thread.subscribe' || method === 'thread.unsubscribe') {
            const parsed = Schema.decodeUnknownResult(methods[method].params)(params)
            if (Result.isSuccess(parsed)) {
              response = orch.withPublication(parsed.success.threadId, response)
            }
          } else if (
            method === 'chrome.subscribe' ||
            method === 'project.create' ||
            method === 'thread.create' ||
            method === 'thread.archive'
          ) {
            response = hub.withChromePublication(
              method === 'chrome.subscribe' ? response : response.pipe(Effect.uninterruptible)
            )
          }
          void run(response).catch(() => {})
        },

        close(ws) {
          hub.dropConnection(ws)
        },
      },
    } satisfies WsServer
  })
}
