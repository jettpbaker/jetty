// Build-time stand-in for the bare `shiki` module (see the vite alias). The
// real package's bundledLanguages drags every grammar into the build as lazy
// chunks (~10MB); @pierre/diffs imports it and offers no way to trim. This shim
// serves the same API limited to the languages in shiki-langs.ts. Named imports
// missing here fail the build loudly — extend the re-export list if a dep needs
// more. `shiki/core` and `shiki/engine/*` subpaths are untouched by the alias.
import { createBundledHighlighter, createSingletonShorthands } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import { aliases, languages } from './shiki-langs'

export { createCssVariablesTheme, getTokenStyleObject, stringifyTokenStyle } from 'shiki/core'
export { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
export { createOnigurumaEngine } from 'shiki/engine/oniguruma'

export const bundledLanguages = {
  ...languages,
  ...Object.fromEntries(Object.entries(aliases).map(([alias, lang]) => [alias, languages[lang]])),
}

export const bundledThemes = {}

export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
})

export const { codeToHtml, codeToHast, codeToTokens, getSingletonHighlighter } =
  createSingletonShorthands(createHighlighter)
