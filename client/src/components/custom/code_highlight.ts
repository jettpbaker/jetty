import type { HighlightRequest } from '@/components/custom/code_html'

import { resolveLanguage } from '@/lib/shiki-langs'
import { getSharedHighlighter, type DiffsHighlighter, type SupportedLanguages } from '@pierre/diffs'

import { syntaxTheme as themes } from './syntax_theme'

// Tokenising runs in a worker so a thread full of code doesn't block the page.
let worker: Worker | undefined
let failed = false
const results = new Map<string, readonly string[]>()
const pending = new Map<string, Set<(html?: readonly string[]) => void>>()

function cacheKey(code: string, language: string) {
  return `${resolveLanguage(language)}:${code}`
}

// No html means the highlight failed, and the block shows its code plain.
function settle(key: string, html?: readonly string[]) {
  if (html) {
    if (results.size >= 512) results.clear()
    results.set(key, html)
  }
  for (const notify of pending.get(key) ?? []) notify(html)
  pending.delete(key)
}

function receive({ data }: MessageEvent<{ key: string; html?: string[] }[]>) {
  for (const { key, html } of data) settle(key, html)
}

// A worker that never loads would otherwise leave a streaming block on its first fragment.
function fail() {
  failed = true
  for (const key of pending.keys()) settle(key)
}

export function cachedHtml(code: string, language: string) {
  return results.get(cacheKey(code, language))
}

export function highlightHtml(
  code: string,
  language: string,
  onResult: (html?: readonly string[]) => void
) {
  const key = cacheKey(code, language)
  const cached = results.get(key)
  if (cached !== undefined) return cached
  if (failed) return onResult()

  const waiters = pending.get(key)
  if (waiters) {
    waiters.add(onResult)
    return
  }
  pending.set(key, new Set([onResult]))

  if (!worker) {
    worker = new Worker(new URL('./code_highlight.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', receive)
    worker.addEventListener('error', fail)
  }
  const request: HighlightRequest = { key, code, lang: resolveLanguage(language) }
  worker.postMessage(request)
}

let highlighter: DiffsHighlighter | undefined

export function loadLanguages(langs: string[]) {
  return getSharedHighlighter({
    themes: [themes.light, themes.dark],
    langs: langs as SupportedLanguages[],
  }).then((loaded) => {
    highlighter = loaded
  })
}

// Undefined until the language has loaded; an unknown language never highlights.
export function highlightTokens(code: string, lang: string) {
  try {
    return highlighter?.codeToTokens(code, { lang, themes, defaultColor: false }).tokens
  } catch {
    return undefined
  }
}
