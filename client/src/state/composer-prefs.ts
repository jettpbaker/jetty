import type { EffortLevel, PermissionMode } from '@jetty/shared/wire'

// The model/effort/approval catalog the composer offers. Ids are what the
// wire (and Claude Code underneath) actually accepts; labels are display.

export type EffortOption = { id: EffortLevel; label: string }
export type ModelOption = { id: string; label: string; efforts: EffortOption[] }
export type ApprovalOption = { id: PermissionMode; label: string }

// effort is an Opus 4.6+/Sonnet 4.6+ capability; Haiku ignores it entirely
// (verified: CLAUDE_EFFORT is unset on Haiku turns)
const LOW_TO_MAX: EffortOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
  { id: 'max', label: 'Max' },
]

export const MODELS: ModelOption[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: LOW_TO_MAX },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: LOW_TO_MAX },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', efforts: [] },
]

export const APPROVAL_MODES: ApprovalOption[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'full_access', label: 'Full access' },
  { id: 'plan', label: 'Plan' },
]

export type ComposerPrefs = {
  model: ModelOption
  /** null for models without effort support */
  effort: EffortOption | null
  approval: ApprovalOption
}

function createComposerPrefs() {
  // Haiku keeps dev turns cheap until a model is deliberately chosen.
  let prefs: ComposerPrefs = {
    model: MODELS[2] ?? MODELS[0]!,
    effort: null,
    approval: APPROVAL_MODES[0]!,
  }
  const listeners = new Set<() => void>()

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return prefs
    },
    set(next: Partial<ComposerPrefs>) {
      prefs = { ...prefs, ...next }
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

export const composerPrefs = createComposerPrefs()
