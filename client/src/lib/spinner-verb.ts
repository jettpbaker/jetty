import spinnerVerbs from './spinner-verbs.json'

// Claude Code's spinner vocabulary. One verb per turn, so the optimistic
// turn-pending row and the reasoning trigger that replaces it stay in step.
const byTurn = new Map<string, string>()

export function pickSpinnerVerb(): string {
  return spinnerVerbs[Math.floor(Math.random() * spinnerVerbs.length)] ?? 'Thinking'
}

export function turnSpinnerVerb(turnId: string): string {
  const existing = byTurn.get(turnId)
  if (existing) return existing
  const verb = pickSpinnerVerb()
  byTurn.set(turnId, verb)
  return verb
}
