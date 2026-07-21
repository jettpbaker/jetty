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

const STORAGE_KEY = 'jetty:composer-prefs'

type StoredPrefs = { model?: string; effort?: string | null; approval?: string }
type StoredState = {
  default?: StoredPrefs
  byThread?: Record<string, StoredPrefs>
}

function fallbackPrefs(): ComposerPrefs {
  // Haiku keeps dev turns cheap until a model is deliberately chosen.
  return {
    model: MODELS[2] ?? MODELS[0]!,
    effort: null,
    approval: APPROVAL_MODES[0]!,
  }
}

function hydratePrefs(stored: StoredPrefs | undefined, base: ComposerPrefs): ComposerPrefs {
  if (!stored) return base
  const model = MODELS.find((option) => option.id === stored.model) ?? base.model
  return {
    model,
    effort: model.efforts.find((option) => option.id === stored.effort) ?? null,
    approval: APPROVAL_MODES.find((option) => option.id === stored.approval) ?? base.approval,
  }
}

function serializePrefs(prefs: ComposerPrefs): StoredPrefs {
  return {
    model: prefs.model.id,
    effort: prefs.effort?.id ?? null,
    approval: prefs.approval.id,
  }
}

function restoreState(): { defaults: ComposerPrefs; byThread: Map<string, ComposerPrefs> } {
  const defaultsBase = fallbackPrefs()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { defaults: defaultsBase, byThread: new Map() }
    const parsed = JSON.parse(raw) as StoredState & StoredPrefs
    // legacy shape was a bare StoredPrefs; treat it as the global default
    const defaultStored =
      parsed.default ??
      (typeof parsed.model === 'string' || parsed.effort !== undefined || parsed.approval
        ? parsed
        : undefined)
    const defaults = hydratePrefs(defaultStored, defaultsBase)
    const byThread = new Map<string, ComposerPrefs>()
    if (parsed.byThread) {
      for (const [threadId, stored] of Object.entries(parsed.byThread)) {
        byThread.set(threadId, hydratePrefs(stored, defaults))
      }
    }
    return { defaults, byThread }
  } catch {
    return { defaults: defaultsBase, byThread: new Map() }
  }
}

function persistState(defaults: ComposerPrefs, byThread: Map<string, ComposerPrefs>): void {
  const stored: StoredState = {
    default: serializePrefs(defaults),
    byThread: Object.fromEntries(
      [...byThread.entries()].map(([id, prefs]) => [id, serializePrefs(prefs)])
    ),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // storage unavailable — prefs stay session-local
  }
}

function createComposerPrefs() {
  const restored = restoreState()
  let defaults = restored.defaults
  const byThread = restored.byThread
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Global default — used by new drafts and threads with no override. */
    getSnapshot() {
      return defaults
    },
    /**
     * Prefs for a draft/thread id. Missing entries fall back to the global
     * default until ensure() pins a copy (first composer open for that scope).
     */
    getFor(scopeId: string | undefined) {
      if (scopeId === undefined) return defaults
      return byThread.get(scopeId) ?? defaults
    },
    /**
     * On first open of a draft/thread composer, pin the current default so a
     * later default swap in another scope cannot rewrite this one. Spec: never
     * retroactively change an existing thread; until then it still "is" the default.
     */
    ensure(scopeId: string) {
      if (byThread.has(scopeId)) return
      byThread.set(scopeId, { ...defaults })
      persistState(defaults, byThread)
    },
    /**
     * Apply a partial update. With a scopeId (draft or thread), writes that
     * scope's override and sets the global default to the resulting selection
     * (future new threads/drafts inherit it; other scoped entries are untouched).
     * Without a scopeId, only the global default changes.
     */
    set(next: Partial<ComposerPrefs>, scopeId?: string) {
      const prior = scopeId !== undefined ? (byThread.get(scopeId) ?? defaults) : defaults
      const merged = { ...prior, ...next }
      // separate objects so a later default-only write can't alias a thread entry
      defaults = { ...merged }
      if (scopeId !== undefined) byThread.set(scopeId, { ...merged })
      persistState(defaults, byThread)
      emit()
    },
  }
}

export const composerPrefs = createComposerPrefs()
