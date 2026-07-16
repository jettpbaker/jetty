import type { ServerWebSocket } from 'bun'

import {
  methods,
  RequestMessage,
  type MethodName,
  type ParamsOf,
  type PushMessage,
  type ResponseMessage,
  type ChromePushData,
} from '@jetty/shared/wire'

import type { Orchestrator } from './orchestrator'
import type { Store } from './store'

import { StoreError } from './store'

export type ConnData = {
  chrome: boolean
  threads: Set<string>
}

export type WsServer = {
  handlers: {
    open(ws: ServerWebSocket<ConnData>): void
    message(ws: ServerWebSocket<ConnData>, raw: string | Buffer): void
    close(ws: ServerWebSocket<ConnData>): void
  }
  hub: {
    pushThread(threadId: string, message: Extract<PushMessage, { sub: 'thread' }>): void
    pushChrome(data: ChromePushData): void
  }
}

export function createWs(store: Store, getOrch: () => Orchestrator): WsServer {
  const chromeSubs = new Set<ServerWebSocket<ConnData>>()
  const threadSubs = new Map<string, Set<ServerWebSocket<ConnData>>>()

  function send(ws: ServerWebSocket<ConnData>, msg: ResponseMessage | PushMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  function respond(ws: ServerWebSocket<ConnData>, msg: ResponseMessage) {
    send(ws, msg)
  }

  function pushChrome(data: ChromePushData) {
    const msg: PushMessage = { sub: 'chrome', data }
    for (const ws of chromeSubs) send(ws, msg)
  }

  function pushThread(threadId: string, message: Extract<PushMessage, { sub: 'thread' }>) {
    const subs = threadSubs.get(threadId)
    if (!subs) return
    for (const ws of subs) send(ws, message)
  }

  function subscribeThread(ws: ServerWebSocket<ConnData>, threadId: string) {
    ws.data.threads.add(threadId)
    let set = threadSubs.get(threadId)
    if (!set) {
      set = new Set()
      threadSubs.set(threadId, set)
    }
    set.add(ws)
  }

  function unsubscribeThread(ws: ServerWebSocket<ConnData>, threadId: string) {
    ws.data.threads.delete(threadId)
    const set = threadSubs.get(threadId)
    if (!set) return
    set.delete(ws)
    if (set.size === 0) threadSubs.delete(threadId)
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

    const orch = getOrch()

    switch (method) {
      case 'chrome.subscribe': {
        ws.data.chrome = true
        chromeSubs.add(ws)
        send(ws, {
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
        pushChrome({ type: 'project.upserted', project })
        return { project }
      }
      case 'thread.create': {
        const p = parsed.data as ParamsOf<'thread.create'>
        const thread = store.createThread(p.projectId)
        pushChrome({ type: 'thread.upserted', thread })
        return { thread }
      }
      case 'thread.archive': {
        const p = parsed.data as ParamsOf<'thread.archive'>
        const thread = store.archiveThread(p.threadId)
        pushChrome({ type: 'thread.upserted', thread })
        return null
      }
      case 'thread.subscribe': {
        const p = parsed.data as ParamsOf<'thread.subscribe'>
        const thread = store.getThread(p.threadId)
        if (!thread) throw new StoreError('not_found', `Thread ${p.threadId} not found`)
        subscribeThread(ws, p.threadId)
        const state = store.getThreadState(p.threadId)
        if (p.afterSeq !== undefined) {
          for (const ev of store.getEventsAfter(p.threadId, p.afterSeq)) {
            send(ws, {
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
        unsubscribeThread(ws, p.threadId)
        return null
      }
      case 'turn.start': {
        const p = parsed.data as ParamsOf<'turn.start'>
        return orch.startTurn({ threadId: p.threadId, text: p.text })
      }
      case 'turn.interrupt': {
        const p = parsed.data as ParamsOf<'turn.interrupt'>
        orch.interrupt(p.threadId)
        return null
      }
      case 'approval.respond': {
        // chunk 5
        return null
      }
      default: {
        const _exhaustive: never = method
        throw new StoreError('unknown_method', `Unknown method: ${_exhaustive}`)
      }
    }
  }

  return {
    hub: { pushThread, pushChrome },
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
        chromeSubs.delete(ws)
        for (const threadId of ws.data.threads) {
          const set = threadSubs.get(threadId)
          if (!set) continue
          set.delete(ws)
          if (set.size === 0) threadSubs.delete(threadId)
        }
        ws.data.threads.clear()
      },
    },
  }
}
