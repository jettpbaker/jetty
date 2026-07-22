import type { HighlighterCore } from 'shiki/core'
import type { CodeHighlighterPlugin, ThemeRegistrationAny } from 'streamdown'

import { languages, resolveLanguage } from '@/lib/shiki-langs'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin['highlight']>>

// Replaces @streamdown/code, which bundles every Shiki grammar. Languages come
// from the shared shiki-langs list; anything else falls back to plain text.
// Themes must be registration objects — a core highlighter can't resolve
// bundled-theme name strings, and jetty only uses its own baked-in theme.
export function createCodePlugin(
  themes: [ThemeRegistrationAny, ThemeRegistrationAny]
): CodeHighlighterPlugin {
  let corePromise: Promise<HighlighterCore> | undefined
  const results = new Map<string, HighlightResult>()
  const pending = new Map<string, Set<(result: HighlightResult) => void>>()

  const core = () =>
    (corePromise ??= createHighlighterCore({
      themes: [...new Set(themes)],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    }))

  const themeNames = { light: themes[0].name ?? 'custom', dark: themes[1].name ?? 'custom' }

  return {
    name: 'shiki',
    type: 'code-highlighter',
    supportsLanguage: (language) => resolveLanguage(language) !== 'text',
    getSupportedLanguages: () =>
      Object.keys(languages) as ReturnType<CodeHighlighterPlugin['getSupportedLanguages']>,
    getThemes: () => themes,
    highlight({ code, language }, callback) {
      const lang = resolveLanguage(language)
      const key = `${lang}:${code.length}:${code.slice(0, 100)}:${code.slice(-100)}`
      const cached = results.get(key)
      if (cached) return cached

      const waiters = pending.get(key)
      if (waiters) {
        if (callback) waiters.add(callback)
        return null
      }
      pending.set(key, new Set(callback ? [callback] : []))

      void (async () => {
        const highlighter = await core()
        if (lang !== 'text' && !highlighter.getLoadedLanguages().includes(lang)) {
          await highlighter.loadLanguage(languages[lang])
        }
        const result = highlighter.codeToTokens(code, { lang, themes: themeNames })
        results.set(key, result)
        const callbacks = pending.get(key)
        pending.delete(key)
        for (const cb of callbacks ?? []) cb(result)
      })().catch((error: unknown) => {
        pending.delete(key)
        console.error('[code-plugin] highlight failed:', error)
      })
      return null
    },
  }
}
