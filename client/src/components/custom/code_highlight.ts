import type { HighlightRequest } from '@/components/custom/code_html'

import { resolveLanguage } from '@/lib/shiki-langs'

// Tokenising runs in a worker so a thread full of code doesn't block the page.
let worker: Worker | undefined
const results = new Map<string, readonly string[]>()
const pending = new Map<string, Set<(html: readonly string[]) => void>>()

function cacheKey(code: string, language: string, numbered: boolean) {
  return `${numbered ? '#' : ''}${resolveLanguage(language)}:${code}`
}

function receive({ data }: MessageEvent<{ key: string; html?: string[] }[]>) {
  for (const { key, html } of data) {
    if (html !== undefined) {
      if (results.size >= 512) results.clear()
      results.set(key, html)
      for (const notify of pending.get(key) ?? []) notify(html)
    }
    pending.delete(key)
  }
}

export function cachedHtml(code: string, language: string, numbered: boolean) {
  return results.get(cacheKey(code, language, numbered))
}

export function highlightHtml(
  code: string,
  language: string,
  numbered: boolean,
  onResult: (html: readonly string[]) => void
) {
  const key = cacheKey(code, language, numbered)
  const cached = results.get(key)
  if (cached !== undefined) return cached

  const waiters = pending.get(key)
  if (waiters) {
    waiters.add(onResult)
    return
  }
  pending.set(key, new Set([onResult]))

  if (!worker) {
    worker = new Worker(new URL('./code_highlight.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', receive)
  }
  const request: HighlightRequest = { key, code, lang: resolveLanguage(language), numbered }
  worker.postMessage(request)
}
