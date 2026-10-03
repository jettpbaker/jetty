import type { HighlighterCore, ThemeRegistration } from 'shiki/core'

import { linesHtml, type HighlightRequest } from '@/components/custom/code_html'
import { languages } from '@/lib/shiki-langs'
import pierreDarkSoft from '@pierre/theme/pierre-dark-soft'
import pierreLightSoft from '@pierre/theme/pierre-light-soft'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// Pierre's resolveTheme refuses to run in a worker, so the themes come straight from its package.
const themes = { light: pierreLightSoft.name, dark: pierreDarkSoft.name }
const core: Promise<HighlighterCore> = createHighlighterCore({
  themes: [pierreLightSoft as ThemeRegistration, pierreDarkSoft as ThemeRegistration],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
})
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
