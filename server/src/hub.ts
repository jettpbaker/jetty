import type { ChromePushData, PushMessage, ResponseMessage } from '@jetty/shared/wire'
import type { ServerWebSocket } from 'bun'

export type ConnData = {
  chrome: boolean
  threads: Set<string>
}

export type Hub = ReturnType<typeof createHub>

export function createHub() {
  const chromeSubs = new Set<ServerWebSocket<ConnData>>()
  const threadSubs = new Map<string, Set<ServerWebSocket<ConnData>>>()

  function send(ws: ServerWebSocket<ConnData>, msg: ResponseMessage | PushMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
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

  function subscribeChrome(ws: ServerWebSocket<ConnData>) {
    ws.data.chrome = true
    chromeSubs.add(ws)
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

  function dropConnection(ws: ServerWebSocket<ConnData>) {
    chromeSubs.delete(ws)
    for (const threadId of ws.data.threads) {
      const set = threadSubs.get(threadId)
      if (!set) continue
      set.delete(ws)
      if (set.size === 0) threadSubs.delete(threadId)
    }
    ws.data.threads.clear()
  }

  return {
    send,
    pushChrome,
    pushThread,
    subscribeChrome,
    subscribeThread,
    unsubscribeThread,
    dropConnection,
  }
}
