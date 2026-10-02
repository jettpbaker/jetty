import type { JourneyName } from './index'

// Generous field defaults until the lab's baseline replaces them.
export const budgets: Record<JourneyName, number> = {
  'app.launch': 3000,
  'thread.switch': 250,
  'thread.open': 1500,
  'turn.send': 5000,
  'turn.stream': 120_000,
  'pr.open': 3000,
  'pr.diff': 2000,
  'composer.key': 100,
}
