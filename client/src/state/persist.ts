import { ThreadState } from '@jetty/shared/reducer'
import { Project, ThreadMeta } from '@jetty/shared/wire'
import { entries, set } from 'idb-keyval'
import { z } from 'zod'

import type { ChromeState, ChromeStore } from './chrome'
import type { TimelineStore } from './timeline'

const CHROME_KEY = 'chrome'
const THREAD_PREFIX = 'thread:'
const DEBOUNCE_MS = 300

const ChromeStateSchema = z.object({
  projects: z.array(Project),
  threads: z.array(ThreadMeta),
})

const pending = new Map<string, unknown>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function parseChromeValue(value: unknown): ChromeState | null {
  const result = ChromeStateSchema.safeParse(value)
  return result.success ? result.data : null
}

export function parseThreadValue(value: unknown): ThreadState | null {
  const result = ThreadState.safeParse(value)
  return result.success ? result.data : null
}

/** Pure entry partition — validation is versioning; garbage is dropped. */
export function collectHydration(pairs: ReadonlyArray<readonly [IDBValidKey, unknown]>): {
  chrome: ChromeState | null
  threads: Map<string, ThreadState>
} {
  let chrome: ChromeState | null = null
  const threads = new Map<string, ThreadState>()

  for (const [key, value] of pairs) {
    if (typeof key !== 'string') continue
    if (key === CHROME_KEY) {
      chrome = parseChromeValue(value)
      continue
    }
    if (!key.startsWith(THREAD_PREFIX)) continue
    const threadId = key.slice(THREAD_PREFIX.length)
    if (!threadId) continue
    const thread = parseThreadValue(value)
    if (thread) threads.set(threadId, thread)
  }

  return { chrome, threads }
}

export function applyHydration(
  pairs: ReadonlyArray<readonly [IDBValidKey, unknown]>,
  chrome: Pick<ChromeStore, 'hydrate'>,
  timeline: Pick<TimelineStore, 'hydrateThread'>
): void {
  const { chrome: chromeState, threads } = collectHydration(pairs)
  if (chromeState) chrome.hydrate(chromeState)
  for (const [threadId, state] of threads) {
    timeline.hydrateThread(threadId, state)
  }
}

export async function hydrate(chrome: ChromeStore, timeline: TimelineStore): Promise<void> {
  let pairs: [IDBValidKey, unknown][]
  try {
    pairs = await entries()
  } catch {
    // Corrupt / unavailable IDB → cold boot.
    return
  }
  applyHydration(pairs, chrome, timeline)
}

function scheduleWrite(key: string, value: unknown): void {
  pending.set(key, value)
  const existing = timers.get(key)
  if (existing !== undefined) clearTimeout(existing)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      const next = pending.get(key)
      pending.delete(key)
      if (next === undefined) return
      void set(key, next).catch(() => {
        // best-effort; next mutation retries
      })
    }, DEBOUNCE_MS)
  )
}

export function persistChrome(state: ChromeState): void {
  scheduleWrite(CHROME_KEY, state)
}

export function persistThread(threadId: string, state: ThreadState): void {
  scheduleWrite(`${THREAD_PREFIX}${threadId}`, state)
}

/** Flush debounced writes immediately (pagehide + tests). */
export function flushPendingWrites(): Promise<void> {
  for (const timer of timers.values()) {
    clearTimeout(timer)
  }
  timers.clear()

  const writes: Promise<void>[] = []
  for (const [key, value] of pending) {
    writes.push(
      set(key, value).catch(() => {
        // best-effort
      })
    )
  }
  pending.clear()
  return Promise.all(writes).then(() => {})
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void flushPendingWrites()
  })
}
