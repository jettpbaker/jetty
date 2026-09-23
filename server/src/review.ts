import { Effect, Semaphore } from 'effect'

import type { UtilityPrompt } from './utility-model'

export type ReviewClassifier = (text: string) => Effect.Effect<boolean>

export const REVIEW_INSTRUCTIONS =
  'Decide whether the user should review or answer this completed assistant reply. Answer YES for delivered work, results, a decision request, or a substantive question. Answer NO for thanks, acknowledgments, greetings, or a reply with no new work or decision. Reply with exactly YES or NO.'

export function createReviewClassifier(prompt: UtilityPrompt): ReviewClassifier {
  const slots = Semaphore.makeUnsafe(2)
  return (text) =>
    slots
      .withPermits(1)(
        prompt(REVIEW_INSTRUCTIONS, `Final assistant reply:\n\n${text.slice(0, 4000)}`).pipe(
          Effect.timeout('15 seconds')
        )
      )
      .pipe(
        Effect.map((answer) => /^\W*yes\b/i.test(answer ?? '')),
        Effect.catch(() => Effect.succeed(false))
      )
}
