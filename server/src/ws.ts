import type { ServerWebSocket } from 'bun'

import {
  methods,
  RequestMessage,
  type MethodName,
  type ParamsOf,
  type ResponseMessage,
} from '@jetty/shared/wire'

import type { Hub, ConnData } from './hub'
import type { Orchestrator } from './orchestrator'
import type { Store } from './store'

import { StoreError } from './store'

export type WsServer = {
  handlers: {
    open(ws: ServerWebSocket<ConnData>): void
    message(ws: ServerWebSocket<ConnData>, raw: string | Buffer): void
    close(ws: ServerWebSocket<ConnData>): void
  }
}

export function createWs(store: Store, orch: Orchestrator, hub: Hub): WsServer {
  function respond(ws: ServerWebSocket<ConnData>, msg: ResponseMessage) {
    hub.send(ws, msg)
  }

  async function dispatch(
    ws: ServerWebSocket<ConnData>,
    method: MethodName,
    params: unknown
  ): Promise<unknown> {
    const schema = methods[method]
    const parsed = schema.params.safeParse(params)
    if (!parsed.success) {
      throw new StoreError('invalid_params', parsed.error.issues[0]?.message ?? 'Invalid params')
    }

    switch (method) {
      case 'chrome.subscribe': {
        hub.subscribeChrome(ws)
        hub.send(ws, {
          sub: 'chrome',
          data: {
            type: 'snapshot',
            projects: store.listProjects(),
            threads: store.listThreads(),
          },
        })
        return null
      }
      case 'project.create': {
        const p = parsed.data as ParamsOf<'project.create'>
        const project = store.createProject(p.path, p.title)
        hub.pushChrome({ type: 'project.upserted', project })
        return { project }
      }
      case 'thread.create': {
        const p = parsed.data as ParamsOf<'thread.create'>
        const thread = store.createThread(p.projectId, p.id)
        hub.pushChrome({ type: 'thread.upserted', thread })
        return { thread }
      }
      case 'thread.archive': {
        const p = parsed.data as ParamsOf<'thread.archive'>
        const thread = store.archiveThread(p.threadId)
        hub.pushChrome({ type: 'thread.upserted', thread })
        return null
      }
      case 'thread.subscribe': {
        const p = parsed.data as ParamsOf<'thread.subscribe'>
        const thread = store.getThread(p.threadId)
        if (!thread) throw new StoreError('not_found', `Thread ${p.threadId} not found`)
        hub.subscribeThread(ws, p.threadId)
        const state = store.getThreadState(p.threadId)
        if (p.afterSeq !== undefined) {
          for (const ev of store.getEventsAfter(p.threadId, p.afterSeq)) {
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
        const p = parsed.data as ParamsOf<'thread.unsubscribe'>
        hub.unsubscribeThread(ws, p.threadId)
        return null
      }
      case 'turn.start': {
        const p = parsed.data as ParamsOf<'turn.start'>
        return orch.startTurn({
          threadId: p.threadId,
          text: p.text,
          attachments: p.attachments,
          model: p.model,
          permissionMode: p.permissionMode,
        })
      }
      case 'turn.interrupt': {
        const p = parsed.data as ParamsOf<'turn.interrupt'>
        orch.interrupt(p.threadId)
        return null
      }
      case 'approval.respond': {
        const p = parsed.data as ParamsOf<'approval.respond'>
        orch.respondApproval(p.threadId, p.itemId, p.decision, p.updatedPermissions)
        return null
      }
      default: {
        const _exhaustive: never = method
        throw new StoreError('unknown_method', `Unknown method: ${_exhaustive}`)
      }
    }
  }

  return {
    handlers: {
      open(ws) {
        ws.data.chrome = false
        ws.data.threads = new Set()
      },

      message(ws, raw) {
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

        const req = RequestMessage.safeParse(json)
        if (!req.success) {
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

        const { id, method, params } = req.data
        void dispatch(ws, method, params)
          .then((result) => {
            respond(ws, { id, ok: true, result })
          })
          .catch((err: unknown) => {
            if (err instanceof StoreError) {
              respond(ws, { id, ok: false, error: { code: err.code, message: err.message } })
              return
            }
            const message = err instanceof Error ? err.message : String(err)
            respond(ws, { id, ok: false, error: { code: 'internal', message } })
          })
      },

      close(ws) {
        hub.dropConnection(ws)
      },
    },
  }
}
