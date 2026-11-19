import type { PullRequestRef } from './pull-requests'

const EVENT_TYPES = [
  'com.github.pull_request.check_suite.status.changed.v1',
  'com.github.pull_request.head.changed.v1',
  'com.github.pull_request.merge_conflict.v1',
  'com.github.pull_request.review.submitted.v1',
  'com.github.pull_request.state.changed.v1',
] as const

const END_FRAME_EVENT = 'github.stream.end'
const DEFAULT_API_BASE = 'https://api.github.com'
const DEFAULT_MAX_STREAMS = 32
const DEFAULT_MIN_RECONNECT_MS = 1_000
const DEFAULT_MAX_RECONNECT_MS = 30_000
// GitHub sends a `:` heartbeat within 15s of the last frame; silence past this is a dead socket.
const DEFAULT_IDLE_TIMEOUT_MS = 45_000
const DEFAULT_RELEASE_GRACE_MS = 15_000
const DEFAULT_UNAVAILABLE_COOLDOWN_MS = 6 * 60 * 60_000
const DEFAULT_LIMIT_COOLDOWN_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 20_000
const DELETE_TIMEOUT_MS = 5_000

export type PullRequestEventKind = 'checks' | 'conflict' | 'full'

export type PullRequestEventsDeps = {
  apiBase?: string
  enabled?: boolean
  token: (opts?: { fresh?: boolean }) => Promise<string | null>
  observeRateLimit: (headers: Headers, body: unknown, status: number, detail?: string) => void
  backingOff: () => boolean
  onEvent: (ref: PullRequestRef, kind: PullRequestEventKind) => void
  onSync: (ref: PullRequestRef) => void
  fetchImpl?: typeof fetch
  idleTimeoutMs?: number
  releaseGraceMs?: number
  minReconnectMs?: number
  maxReconnectMs?: number
  maxStreams?: number
  unavailableCooldownMs?: number
  limitCooldownMs?: number
}

export type PullRequestEvents = ReturnType<typeof createPullRequestEvents>

type SseFrame = {
  event: string
  data: string
  id: string
}

type StreamEnd = {
  outcome?: string
  reason?: string
}

type SubscriptionResult =
  | { kind: 'ok'; id: string; created: boolean }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }
  | { kind: 'not_found' }
  | { kind: 'limit' }
  | { kind: 'invalid'; message: string }
  | { kind: 'retry'; retryAfterMs: number; message: string }

type OpenResult =
  | { kind: 'ok'; body: ReadableStream<Uint8Array> }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }
  | { kind: 'not_found' }
  | { kind: 'retry'; retryAfterMs: number; message: string }

type StreamEntry = {
  key: string
  ref: PullRequestRef
  controller: AbortController
  connected: boolean
  subscriptionId: string | null
  createdSubscription: boolean
  releaseTimer?: ReturnType<typeof setTimeout>
  done: Promise<void>
}

function refKey(ref: PullRequestRef) {
  return `${ref.repo}#${ref.number}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function parseRetryAfterMs(headers: Headers): number {
  const value = headers.get('retry-after')?.trim()
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0
}

function jitteredDelay(baseMs: number, retryAfterMs: number) {
  const jitter = Math.floor(Math.random() * (baseMs / 2))
  return Math.max(baseMs + jitter, retryAfterMs)
}

function eventKind(eventType: string): PullRequestEventKind {
  if (eventType === 'com.github.pull_request.check_suite.status.changed.v1') return 'checks'
  if (eventType === 'com.github.pull_request.merge_conflict.v1') return 'conflict'
  return 'full'
}

function sleepAbortable(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
  streamAbort: AbortController,
  idleTimeoutMs: number,
  onHeartbeat: () => void
): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let firstLine = true
  let eventName = ''
  let eventId = ''
  let dataLines: string[] = []
  let sawField = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false

  function resetIdle() {
    clearTimeout(idleTimer)
    if (idleTimeoutMs <= 0) return
    idleTimer = setTimeout(() => {
      timedOut = true
      streamAbort.abort()
      void reader.cancel().catch(() => {})
    }, idleTimeoutMs)
    idleTimer.unref()
  }

  const onAbort = () => {
    void reader.cancel().catch(() => {})
  }
  streamAbort.signal.addEventListener('abort', onAbort, { once: true })
  resetIdle()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        if (timedOut) throw new Error('Event stream idle timeout')
        break
      }
      resetIdle()
      buffer += decoder.decode(value, { stream: true })

      let start = 0
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer.charCodeAt(i)
        if (ch !== 10 && ch !== 13) continue
        // Wait for the next chunk if \r is the last character, in case \r\n splits across chunks.
        if (ch === 13 && i === buffer.length - 1) break
        let line = buffer.slice(start, i)
        if (ch === 13 && buffer.charCodeAt(i + 1) === 10) i++
        start = i + 1

        if (firstLine) {
          firstLine = false
          if (line.startsWith('\uFEFF')) line = line.slice(1)
        }

        if (line === '') {
          if (sawField) {
            yield { event: eventName, data: dataLines.join('\n'), id: eventId }
            eventName = ''
            eventId = ''
            dataLines = []
            sawField = false
          }
          continue
        }
        if (line.startsWith(':')) {
          onHeartbeat()
          continue
        }
        const colon = line.indexOf(':')
        const field = colon >= 0 ? line.slice(0, colon) : line
        let fieldValue = colon >= 0 ? line.slice(colon + 1) : ''
        if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1)
        if (field === 'event') {
          eventName = fieldValue
          sawField = true
        } else if (field === 'data') {
          dataLines.push(fieldValue)
          sawField = true
        } else if (field === 'id') {
          eventId = fieldValue
          sawField = true
        }
      }
      buffer = buffer.slice(start)
    }
  } finally {
    clearTimeout(idleTimer)
    streamAbort.signal.removeEventListener('abort', onAbort)
    await reader.cancel().catch(() => {})
  }
}

export function createPullRequestEvents(deps: PullRequestEventsDeps) {
  const apiBase = (deps.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '')
  const enabled = deps.enabled ?? true
  const customBase = deps.apiBase !== undefined
  const fetchFn = deps.fetchImpl ?? fetch
  const idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const releaseGraceMs = deps.releaseGraceMs ?? DEFAULT_RELEASE_GRACE_MS
  const minReconnectMs = deps.minReconnectMs ?? DEFAULT_MIN_RECONNECT_MS
  const maxReconnectMs = deps.maxReconnectMs ?? DEFAULT_MAX_RECONNECT_MS
  const maxStreams = deps.maxStreams ?? DEFAULT_MAX_STREAMS
  const unavailableCooldownMs = deps.unavailableCooldownMs ?? DEFAULT_UNAVAILABLE_COOLDOWN_MS
  const limitCooldownMs = deps.limitCooldownMs ?? DEFAULT_LIMIT_COOLDOWN_MS

  let viewed: PullRequestRef[] = []
  let linked: PullRequestRef[] = []
  let closed = false
  let unavailable: { token: string | null; until: number } | null = null
  let limitCooldownUntil = 0
  const blocked = new Set<string>()
  const streams = new Map<string, StreamEntry>()
  const draining = new Set<Promise<void>>()

  function headers(token: string | null, accept: string, json = false): Record<string, string> {
    return {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Jetty',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  async function resolveToken(fresh = false) {
    if (customBase) return null
    return deps.token({ fresh })
  }

  async function createSubscription(
    ref: PullRequestRef,
    token: string | null,
    signal: AbortSignal
  ): Promise<SubscriptionResult> {
    let response: Response
    try {
      response = await fetchFn(`${apiBase}/event-subscriptions`, {
        method: 'POST',
        headers: headers(token, 'application/vnd.github+json', true),
        body: JSON.stringify({
          resource_url: `https://github.com/${ref.repo}/pull/${ref.number}`,
          event_types: [...EVENT_TYPES],
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      })
    } catch (error) {
      return { kind: 'retry', retryAfterMs: 0, message: String(error) }
    }
    const text = await response.text().catch(() => '')
    const parsed = parseJson(text)
    const body = asRecord(parsed)
    const message = typeof body.message === 'string' ? body.message : ''
    deps.observeRateLimit(response.headers, parsed, response.status, message)

    if (response.status === 200 || response.status === 201) {
      const id = typeof body.id === 'string' ? body.id : ''
      if (!id) return { kind: 'retry', retryAfterMs: 0, message: 'Missing subscription id' }
      return { kind: 'ok', id, created: response.status === 201 }
    }
    if (response.status === 401) return { kind: 'unauthorized' }
    if (response.status === 403) {
      if (deps.backingOff())
        return {
          kind: 'retry',
          retryAfterMs: parseRetryAfterMs(response.headers),
          message: message || 'Rate limited',
        }
      return { kind: 'unavailable' }
    }
    if (response.status === 404) return { kind: 'not_found' }
    if (response.status === 422) {
      const hasFieldErrors = Array.isArray(body.errors) && body.errors.length > 0
      if (!hasFieldErrors || /limit/i.test(message)) return { kind: 'limit' }
      return { kind: 'invalid', message: message || 'Invalid event subscription request' }
    }
    if (response.status === 429 || response.status >= 500)
      return {
        kind: 'retry',
        retryAfterMs: parseRetryAfterMs(response.headers),
        message: message || `HTTP ${response.status}`,
      }
    return { kind: 'invalid', message: message || `HTTP ${response.status}` }
  }

  async function openStream(
    subscriptionId: string,
    token: string | null,
    streamAbort: AbortController
  ): Promise<OpenResult> {
    // Only bound waiting for headers; a healthy SSE body stays open indefinitely.
    const connectTimer = setTimeout(() => streamAbort.abort(), REQUEST_TIMEOUT_MS)
    connectTimer.unref()
    let response: Response
    try {
      response = await fetchFn(
        `${apiBase}/event-subscriptions/${encodeURIComponent(subscriptionId)}/events`,
        {
          method: 'GET',
          headers: headers(token, 'text/event-stream'),
          signal: streamAbort.signal,
        }
      )
    } catch (error) {
      return { kind: 'retry', retryAfterMs: 0, message: String(error) }
    } finally {
      clearTimeout(connectTimer)
    }

    if (response.status === 200) {
      const contentType = response.headers.get('content-type') ?? ''
      const mediaType = contentType.split(';')[0]?.trim().toLowerCase()
      if (mediaType !== 'text/event-stream' || !response.body) {
        await response.body?.cancel().catch(() => {})
        return {
          kind: 'retry',
          retryAfterMs: 0,
          message: `Unexpected event stream content type ${contentType || 'none'}`,
        }
      }
      return { kind: 'ok', body: response.body }
    }

    const text = await response.text().catch(() => '')
    const parsed = parseJson(text)
    const body = asRecord(parsed)
    const message = typeof body.message === 'string' ? body.message : ''
    deps.observeRateLimit(response.headers, parsed, response.status, message)

    if (response.status === 401) return { kind: 'unauthorized' }
    if (response.status === 403) {
      if (deps.backingOff())
        return {
          kind: 'retry',
          retryAfterMs: parseRetryAfterMs(response.headers),
          message: message || 'Rate limited',
        }
      return { kind: 'unavailable' }
    }
    if (response.status === 404) return { kind: 'not_found' }
    return {
      kind: 'retry',
      retryAfterMs: parseRetryAfterMs(response.headers),
      message: message || `HTTP ${response.status}`,
    }
  }

  async function deleteSubscription(subscriptionId: string) {
    try {
      const token = await resolveToken()
      if (!customBase && !token) return
      const response = await fetchFn(
        `${apiBase}/event-subscriptions/${encodeURIComponent(subscriptionId)}`,
        {
          method: 'DELETE',
          headers: headers(token, 'application/vnd.github+json'),
          signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
        }
      )
      await response.body?.cancel().catch(() => {})
    } catch {}
  }

  function markUnavailable(token: string | null) {
    const first = !unavailable || unavailable.token !== token || Date.now() >= unavailable.until
    unavailable = { token, until: Date.now() + unavailableCooldownMs }
    if (first)
      console.info(
        '[pr-events] GitHub Event Streams unavailable for this account; staying on polling'
      )
    for (const key of streams.keys()) stopStream(key)
  }

  function stopStream(key: string) {
    const entry = streams.get(key)
    if (!entry) return
    streams.delete(key)
    clearTimeout(entry.releaseTimer)
    entry.releaseTimer = undefined
    entry.connected = false
    entry.controller.abort()
  }

  async function runStream(entry: StreamEntry) {
    let delay = minReconnectMs
    let resubscribed = false
    let refreshToken = false
    let unauthorizedAttempts = 0

    try {
      while (!entry.controller.signal.aborted && !closed) {
        if (deps.backingOff()) {
          await sleepAbortable(Math.min(maxReconnectMs, 5_000), entry.controller.signal)
          continue
        }

        const token = await resolveToken(refreshToken)
        refreshToken = false
        if (!customBase && !token) break
        if (unavailable && unavailable.token === token && Date.now() < unavailable.until) break

        if (!entry.subscriptionId) {
          if (Date.now() < limitCooldownUntil) break
          const created = await createSubscription(entry.ref, token, entry.controller.signal)
          if (entry.controller.signal.aborted || closed) break
          if (created.kind === 'ok') {
            entry.subscriptionId = created.id
            entry.createdSubscription = created.created
            unauthorizedAttempts = 0
          } else if (created.kind === 'unauthorized') {
            if (unauthorizedAttempts++ >= 1 || customBase) break
            refreshToken = true
            continue
          } else if (created.kind === 'unavailable') {
            markUnavailable(token)
            break
          } else if (created.kind === 'not_found') {
            blocked.add(entry.key)
            break
          } else if (created.kind === 'limit') {
            limitCooldownUntil = Date.now() + limitCooldownMs
            console.info(
              `[pr-events] subscription limit reached; pausing new streams for ${Math.round(limitCooldownMs / 60_000)}m`
            )
            break
          } else if (created.kind === 'invalid') {
            console.warn(`[pr-events] ${entry.key} ${created.message}`)
            blocked.add(entry.key)
            break
          } else {
            await sleepAbortable(
              jitteredDelay(delay, created.retryAfterMs),
              entry.controller.signal
            )
            delay = Math.min(delay * 2, maxReconnectMs)
            continue
          }
        }

        const streamAbort = new AbortController()
        const onEntryAbort = () => streamAbort.abort()
        entry.controller.signal.addEventListener('abort', onEntryAbort, { once: true })
        let delivered = false
        let endFrame: StreamEnd | null = null

        try {
          const opened = await openStream(entry.subscriptionId, token, streamAbort)
          if (entry.controller.signal.aborted || closed) break
          if (opened.kind === 'unauthorized') {
            if (unauthorizedAttempts++ >= 1 || customBase) break
            refreshToken = true
            continue
          }
          if (opened.kind === 'unavailable') {
            markUnavailable(token)
            break
          }
          if (opened.kind === 'not_found') {
            entry.subscriptionId = null
            entry.createdSubscription = false
            if (resubscribed) {
              await sleepAbortable(jitteredDelay(delay, 0), entry.controller.signal)
              delay = Math.min(delay * 2, maxReconnectMs)
            }
            resubscribed = true
            continue
          }
          if (opened.kind === 'retry') {
            await sleepAbortable(jitteredDelay(delay, opened.retryAfterMs), entry.controller.signal)
            delay = Math.min(delay * 2, maxReconnectMs)
            continue
          }

          resubscribed = false
          unauthorizedAttempts = 0
          entry.connected = true

          try {
            deps.onSync(entry.ref)
          } catch (error) {
            console.warn(`[pr-events] sync ${entry.key} ${String(error)}`)
          }

          try {
            for await (const frame of readSseFrames(opened.body, streamAbort, idleTimeoutMs, () => {
              delivered = true
            })) {
              if (entry.controller.signal.aborted || closed) break
              if (frame.event === END_FRAME_EVENT) {
                const parsed = asRecord(parseJson(frame.data))
                endFrame = {
                  outcome: typeof parsed.outcome === 'string' ? parsed.outcome : undefined,
                  reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
                }
                break
              }
              delivered = true
              const parsed = asRecord(parseJson(frame.data))
              const type = frame.event || (typeof parsed.type === 'string' ? parsed.type : '')
              try {
                deps.onEvent(entry.ref, eventKind(type))
              } catch (error) {
                console.warn(`[pr-events] event ${entry.key} ${String(error)}`)
              }
            }
          } catch (error) {
            if (!entry.controller.signal.aborted && !closed)
              console.debug(`[pr-events] ${entry.key} reconnecting: ${String(error)}`)
          } finally {
            entry.connected = false
          }
        } finally {
          entry.controller.signal.removeEventListener('abort', onEntryAbort)
          streamAbort.abort()
        }

        if (entry.controller.signal.aborted || closed) break

        if (endFrame?.outcome === 'subscription_ended') {
          entry.subscriptionId = null
          entry.createdSubscription = false
          if (endFrame.reason === 'access_revoked') {
            blocked.add(entry.key)
            break
          }
          resubscribed = true
        } else if (endFrame?.outcome === 'reconnect') {
          refreshToken = true
        }

        if (delivered) delay = minReconnectMs
        await sleepAbortable(jitteredDelay(delay, 0), entry.controller.signal)
        delay = Math.min(delay * 2, maxReconnectMs)
      }
    } finally {
      clearTimeout(entry.releaseTimer)
      entry.releaseTimer = undefined
      entry.connected = false
      if (streams.get(entry.key) === entry) streams.delete(entry.key)
      // The SSE body has already been cancelled above; only delete subscriptions Jetty created.
      if (entry.subscriptionId && entry.createdSubscription)
        await deleteSubscription(entry.subscriptionId)
    }
  }

  function startStream(key: string, ref: PullRequestRef) {
    const entry: StreamEntry = {
      key,
      ref,
      controller: new AbortController(),
      connected: false,
      subscriptionId: null,
      createdSubscription: false,
      done: Promise.resolve(),
    }
    streams.set(key, entry)
    const done = runStream(entry).finally(() => {
      draining.delete(done)
    })
    entry.done = done
    draining.add(done)
  }

  function reconcile() {
    if (closed) return
    const desired = new Map<string, PullRequestRef>()
    for (const ref of [...viewed, ...linked]) {
      const key = refKey(ref)
      if (desired.has(key) || blocked.has(key)) continue
      desired.set(key, ref)
      if (desired.size >= maxStreams) break
    }

    for (const [key, entry] of streams) {
      if (desired.has(key)) {
        clearTimeout(entry.releaseTimer)
        entry.releaseTimer = undefined
      } else if (!entry.releaseTimer) {
        entry.releaseTimer = setTimeout(() => {
          entry.releaseTimer = undefined
          stopStream(key)
        }, releaseGraceMs)
        entry.releaseTimer.unref()
      }
    }

    if (!enabled || Date.now() < limitCooldownUntil) return
    if (unavailable && Date.now() < unavailable.until) return
    if (unavailable && Date.now() >= unavailable.until) unavailable = null

    for (const [key, ref] of desired) {
      if (streams.has(key)) continue
      if (streams.size >= maxStreams) {
        const releasing = [...streams.values()].find((entry) => entry.releaseTimer !== undefined)
        if (!releasing) break
        stopStream(releasing.key)
      }
      startStream(key, ref)
    }
  }

  return {
    setViewed(refs: readonly PullRequestRef[]) {
      viewed = [...refs]
      reconcile()
    },
    setLinked(refs: readonly PullRequestRef[]) {
      linked = [...refs]
      reconcile()
    },
    isConnected(ref: PullRequestRef) {
      return streams.get(refKey(ref))?.connected === true
    },
    forget(ref: PullRequestRef) {
      blocked.delete(refKey(ref))
    },
    resetAuth() {
      unavailable = null
      blocked.clear()
      for (const key of streams.keys()) stopStream(key)
      reconcile()
    },
    async close() {
      closed = true
      for (const key of streams.keys()) stopStream(key)
      await Promise.allSettled(draining)
    },
  }
}
