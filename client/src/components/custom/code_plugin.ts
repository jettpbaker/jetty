import type { HighlighterCore } from 'shiki/core'
import type { CodeHighlighterPlugin } from 'streamdown'

import { languages, resolveLanguage } from '@/lib/shiki-langs'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin['highlight']>>

export const shikiThemes: [typeof githubLight, typeof githubDark] = [githubLight, githubDark]

export function createCodePlugin(): CodeHighlighterPlugin {
  let corePromise: Promise<HighlighterCore> | undefined
  const results = new Map<string, HighlightResult>()
  const pending = new Map<string, Set<(result: HighlightResult) => void>>()
  const themeNames = { light: githubLight.name, dark: githubDark.name }

  function core() {
    corePromise ??= createHighlighterCore({
      themes: shikiThemes,
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
    return corePromise
  }

  return {
    name: 'shiki',
    type: 'code-highlighter',
    supportsLanguage: (language) => resolveLanguage(language) !== 'text',
    getSupportedLanguages: () => Object.keys(languages),
    getThemes: () => shikiThemes,
    highlight({ code, language }, callback) {
      const lang = resolveLanguage(language)
      const key = `${lang}:${code}`
      const cached = results.get(key)
      if (cached) return cached

      const waiters = pending.get(key)
      if (waiters) {
        if (callback) waiters.add(callback)
        return null
      }
      pending.set(key, new Set(callback ? [callback] : []))

      void core()
        .then(async (highlighter) => {
          if (lang !== 'text' && !highlighter.getLoadedLanguages().includes(lang))
            await highlighter.loadLanguage(languages[lang])
          const result = highlighter.codeToTokens(code, { lang, themes: themeNames })
          if (results.size >= 512) results.clear()
          results.set(key, result)
          for (const notify of pending.get(key) ?? []) notify(result)
          pending.delete(key)
        })
        .catch(() => {
          pending.delete(key)
        })
      return null
    },
  }
}
