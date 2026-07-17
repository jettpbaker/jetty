import {
  newId,
  ServerMessage,
  type ChromePushData,
  type MethodName,
  type ParamsOf,
  type PushMessage,
  type ResultOf,
  type WireError,
} from '@jetty/shared/wire'

type ThreadPush = Extract<PushMessage, { sub: 'thread' }>

type Pending = {
  resolve: (result: unknown) => void
  reject: (error: WireError) => void
}

export type Socket = {
  request: <M extends MethodName>(method: M, params: ParamsOf<M>) => Promise<ResultOf<M>>
  onChromePush: (handler: (data: ChromePushData) => void) => () => void
  onThreadPush: (handler: (push: ThreadPush) => void) => () => void
  /** Fires on every successful open, including the initial connect. */
  onReconnect: (handler: () => void) => () => void
  /** Drop the active connection so auto-reconnect runs (tests / recovery). */
  reconnect: () => void
  close: () => void
}

const INITIAL_BACKOFF_MS = 200
const MAX_BACKOFF_MS = 5000

export function createSocket(url: string): Socket {
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const pending = new Map<string, Pending>()
  const chromeHandlers = new Set<(data: ChromePushData) => void>()
  const threadHandlers = new Set<(push: ThreadPush) => void>()
  const reconnectHandlers = new Set<() => void>()
  const openWaiters = new Set<() => void>()

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function rejectAllPending(error: WireError) {
    for (const [, p] of pending) {
      p.reject(error)
    }
    pending.clear()
  }

  function handleMessage(raw: string) {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return
    }

    const parsed = ServerMessage.safeParse(json)
    if (!parsed.success) return

    const msg = parsed.data

    if ('ok' in msg) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) {
        p.resolve(msg.result)
      } else {
        p.reject(msg.error ?? { code: 'internal', message: 'unknown error' })
      }
      return
    }

    if (msg.sub === 'chrome') {
      for (const handler of chromeHandlers) {
        handler(msg.data)
      }
      return
    }

    for (const handler of threadHandlers) {
      handler(msg)
    }
  }

  function connect() {
    if (closed) return
    clearReconnectTimer()

    const next = new WebSocket(url)
    ws = next

    next.addEventListener('open', () => {
      if (ws !== next) return
      attempt = 0
      for (const wake of openWaiters) wake()
      openWaiters.clear()
      for (const handler of reconnectHandlers) {
        handler()
      }
    })

    next.addEventListener('message', (ev) => {
      if (ws !== next) return
      handleMessage(String(ev.data))
    })

    next.addEventListener('close', () => {
      if (ws !== next) return
      ws = null
      rejectAllPending({ code: 'internal', message: 'connection closed' })
      if (closed) return
      const delay = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** attempt)
      attempt += 1
      reconnectTimer = setTimeout(connect, delay)
    })

    next.addEventListener('error', () => {
      // close handler drives reconnect
      next.close()
    })
  }

  function whenOpen(): Promise<void> {
    if (ws?.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve) => {
      openWaiters.add(resolve)
    })
  }

  async function request<M extends MethodName>(
    method: M,
    params: ParamsOf<M>
  ): Promise<ResultOf<M>> {
    if (closed) {
      return Promise.reject({ code: 'internal', message: 'socket closed' } satisfies WireError)
    }

    await whenOpen()
    if (closed || !ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject({ code: 'internal', message: 'connection closed' } satisfies WireError)
    }

    const id = newId()
    return new Promise<ResultOf<M>>((resolve, reject) => {
      pending.set(id, {
        resolve: (result) => resolve(result as ResultOf<M>),
        reject,
      })
      ws!.send(JSON.stringify({ id, method, params }))
    })
  }

  function onChromePush(handler: (data: ChromePushData) => void) {
    chromeHandlers.add(handler)
    return () => {
      chromeHandlers.delete(handler)
    }
  }

  function onThreadPush(handler: (push: ThreadPush) => void) {
    threadHandlers.add(handler)
    return () => {
      threadHandlers.delete(handler)
    }
  }

  function onReconnect(handler: () => void) {
    reconnectHandlers.add(handler)
    return () => {
      reconnectHandlers.delete(handler)
    }
  }

  function reconnect() {
    if (closed) return
    clearReconnectTimer()
    const current = ws
    // Detach first so the close handler does not double-schedule reconnect.
    ws = null
    rejectAllPending({ code: 'internal', message: 'connection closed' })
    attempt = 0
    current?.close()
    connect()
  }

  function close() {
    closed = true
    clearReconnectTimer()
    // Wake parked requests so they hit the closed check and reject, not hang.
    for (const wake of openWaiters) wake()
    openWaiters.clear()
    rejectAllPending({ code: 'internal', message: 'socket closed' })
    const current = ws
    ws = null
    current?.close()
  }

  connect()

  return { request, onChromePush, onThreadPush, onReconnect, reconnect, close }
}
