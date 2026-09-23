import { Effect } from 'effect'

export type Titler = (text: string) => Effect.Effect<string | null>

const MAX_TITLE_LEN = 60
const TITLE_TIMEOUT = '30 seconds'
const REPLY_OPENER = /^(i['’]d|i['’]ll|i['’]m|i can|sure|happy|of course|certainly)\b/i

export const TITLE_INSTRUCTIONS =
  'Name the user’s task in 2–6 words, as a human would label a to-do. Use sentence case and preserve names and acronyms. Do not answer the request. Reply with only the task name, without quotes or punctuation. Example: “can you look into why the login test keeps failing on CI?” → “Fix flaky login test”.'

export const titlePrompt = (text: string) =>
  `Title this conversation opener:\n\n<opening-message>\n${text}\n</opening-message>`

export function normalizeTitle(raw: string | null | undefined): string | null {
  if (!raw) return null
  let title = raw.trim()
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim()
  }
  if (!title || REPLY_OPENER.test(title) || /^title:/i.test(title)) return null
  return clampTitle(title)
}

export const firstLineTitler: Titler = (text) =>
  Effect.succeed(clampTitle(text.split('\n').find((line) => line.trim()) ?? ''))

export function chainTitlers(...titlers: Titler[]): Titler {
  return (text) =>
    Effect.gen(function* () {
      for (const titler of titlers) {
        const title = yield* titler(text).pipe(
          Effect.timeout(TITLE_TIMEOUT),
          Effect.catchCause(() => Effect.succeed(null))
        )
        if (title) return title
      }
      return null
    })
}

function clampTitle(title: string): string | null {
  return title.trim().slice(0, MAX_TITLE_LEN).trimEnd() || null
}
