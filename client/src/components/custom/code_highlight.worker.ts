import type { HighlighterCore, ThemeRegistration } from 'shiki/core'

import { linesHtml, type HighlightRequest } from '@/components/custom/code_html'
import { languages } from '@/lib/shiki-langs'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import { cursorDark, cursorLight } from './diff/cursor_themes'

// Pierre's resolveTheme refuses to run in a worker, so the theme comes as data (syntax_theme.ts).
const themes = { light: cursorLight.name, dark: cursorDark.name }
const core: Promise<HighlighterCore> = createHighlighterCore({
  themes: [cursorLight as ThemeRegistration, cursorDark as ThemeRegistration],
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
