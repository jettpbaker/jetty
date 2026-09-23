import { Effect, Semaphore } from 'effect'

import type { StdioProcessOptions } from './stdio-rpc'

import { createCodexPrompt } from './codex-titler'

export type ReviewClassifier = (text: string) => Effect.Effect<boolean>

export const REVIEW_INSTRUCTIONS =
  'Decide whether the user should review or answer this completed assistant reply. Answer YES for delivered work, results, a decision request, or a substantive question. Answer NO for thanks, acknowledgments, greetings, or a reply with no new work or decision. Reply with exactly YES or NO.'

export function createReviewClassifier(options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const prompt = yield* createCodexPrompt(options)
    const slots = Semaphore.makeUnsafe(2)
    const classify: ReviewClassifier = (text) =>
      slots
        .withPermits(1)(
          prompt(REVIEW_INSTRUCTIONS, `Final assistant reply:\n\n${text.slice(0, 4000)}`)
        )
        .pipe(
          Effect.timeout('15 seconds'),
          Effect.map((answer) => answer?.trim().toUpperCase() === 'YES'),
          Effect.catch(() => Effect.succeed(false))
        )
    return classify
  })
}
