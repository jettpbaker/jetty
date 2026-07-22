// Aliased over bare `shiki` (see vite.config) so @pierre/diffs shares the
// trimmed language set from shiki-langs.ts. Every named import a consumer uses
// must be re-exported here or the build fails. `shiki/core` and
// `shiki/engine/*` subpaths bypass the alias and hit the real package.
import { createBundledHighlighter, createSingletonShorthands } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import { aliases, languages } from './shiki-langs'

export { createCssVariablesTheme, getTokenStyleObject, stringifyTokenStyle } from 'shiki/core'
export { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
export { createOnigurumaEngine } from 'shiki/engine/oniguruma'

const loaders: Record<string, (typeof languages)[keyof typeof languages]> = {
  ...languages,
  ...Object.fromEntries(Object.entries(aliases).map(([alias, lang]) => [alias, languages[lang]])),
}

const plainTextLoader = (name: string) => () =>
  Promise.resolve({ default: [{ name, scopeName: `source.${name}`, patterns: [] }] })

// pierre derives languages from file extensions and its resolveLanguage throws
// on keys missing here (an unhandled rejection per diff render). Report every
// key present and serve an empty grammar, so out-of-set files tokenize as
// plain text instead of throwing.
export const bundledLanguages = new Proxy(loaders, {
  has: () => true,
  getOwnPropertyDescriptor: (target, key) =>
    Object.getOwnPropertyDescriptor(target, key) ?? {
      value: undefined,
      writable: true,
      enumerable: false,
      configurable: true,
    },
  get: (target, key) =>
    target[key as string] ?? (typeof key === 'string' ? plainTextLoader(key) : undefined),
})

export const bundledThemes = {}

export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
})

export const { codeToHtml, codeToHast, codeToTokens, getSingletonHighlighter } =
  createSingletonShorthands(createHighlighter)
