import type { HighlighterCore } from 'shiki/core'

import { linesHtml, type HighlightRequest } from '@/components/custom/code_html'
import { languages } from '@/lib/shiki-langs'
import { resolveTheme } from '@pierre/diffs'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const themes = { light: 'pierre-light-soft', dark: 'pierre-dark-soft' } as const
const core: Promise<HighlighterCore> = createCore()

async function createCore() {
  return createHighlighterCore({
    themes: await Promise.all([resolveTheme(themes.light), resolveTheme(themes.dark)]),
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
}
const queue: HighlightRequest[] = []
let draining = false

// Requests come in bursts (every block a thread mounts), so they're answered as one message: one
// render on the page instead of one per block.
async function drain() {
  const results: { key: string; html?: string[] }[] = []
  for (let request = queue.shift(); request; request = queue.shift()) {
    const { key, code, lang, numbered } = request
    try {
      const highlighter = await core
      if (lang !== 'text' && !highlighter.getLoadedLanguages().includes(lang))
        await highlighter.loadLanguage(languages[lang])
      const { tokens } = highlighter.codeToTokens(code, { lang, themes })
      results.push({ key, html: linesHtml(tokens, numbered) })
    } catch {
      results.push({ key })
    }
  }
  draining = false
  postMessage(results)
}

addEventListener('message', ({ data }: MessageEvent<HighlightRequest>) => {
  queue.push(data)
  if (draining) return
  draining = true
  setTimeout(drain)
})
