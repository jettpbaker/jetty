import { Effect } from 'effect'

import type { TitlePrompt } from './title-model'

export type Titler = (text: string) => Effect.Effect<string | null, unknown>

const MAX_TITLE_LEN = 60
const TITLE_TIMEOUT = '30 seconds'
const REPLY_OPENER = /^(i['’]d|i['’]ll|i['’]m|i can|sure|happy|of course|certainly)\b/i

// Adapted from T3 Code's initial thread title prompt.
export const TITLE_INSTRUCTIONS = `Generate a title that will help the user recognize this Jetty thread weeks later. Do not answer the request. Reply with only the title, without quotes.

Before answering, silently reduce the request to:
- Subject: What system, feature, or problem is this really about?
- Outcome: What does the user ultimately want to understand or change?
- Incidental instructions: What only describes how the agent should do the work?

Title the subject and outcome. Discard incidental instructions.

Editorial rules:
- 3–8 words, usually fewer than 40 characters.
- Sentence case. Preserve names and acronyms.
- Use a compact noun phrase or clear action phrase.
- Capture the umbrella goal when the request lists several symptoms or steps.
- Name the product change, not the mock, plan, report, branch, or PR used to produce it.
- Models, subagents, tools, output formats, and monitoring instructions do not belong in the title unless they are themselves the topic.
- For reviews, name what is being reviewed and the relevant concern. Avoid generic titles such as “Review PR 123” when the message reveals the subject.
- For research, name the question domain rather than the requested research process.
- Do not claim the work is complete.
- Do not copy and truncate the user’s message.
- Avoid project names already visible in the UI, quotes, labels, filler, and trailing punctuation.
- If a linked PR or issue is the only subject, use the user’s stated action plus its number, such as “Take over PR 8588”.

Example: “can you look into why the login test keeps failing on CI?” → “Fix flaky login test”.`

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

export function titleModelTitler(prompt: TitlePrompt): Titler {
  return (text) =>
    prompt(TITLE_INSTRUCTIONS, titlePrompt(text)).pipe(
      Effect.flatMap((reply) => {
        const title = normalizeTitle(reply)
        if (title) return Effect.succeed(title)
        return Effect.fail(new Error(`Title model reply is not a title: ${JSON.stringify(reply)}`))
      })
    )
}

export function firstLineTitler(text: string) {
  return Effect.succeed(clampTitle(text.split('\n').find((line) => line.trim()) ?? ''))
}

export function chainTitlers(...titlers: Titler[]): (text: string) => Effect.Effect<string | null> {
  return (text) =>
    Effect.gen(function* () {
      for (const titler of titlers) {
        const title = yield* titler(text).pipe(
          Effect.timeout(TITLE_TIMEOUT),
          Effect.catchCause((cause) =>
            Effect.logWarning('Thread titler failed', cause).pipe(Effect.as(null))
          )
        )
        if (title) return title
      }
      return null
    })
}

function clampTitle(title: string): string | null {
  return title.trim().slice(0, MAX_TITLE_LEN).trimEnd() || null
}
