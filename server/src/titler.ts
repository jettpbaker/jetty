/**
 * The title-generation seam, provider-agnostic like the Agent seam: the
 * orchestrator only knows this shape. Each provider ships its own
 * implementation (createClaudeTitler today; a codex/ACP titler slots in the
 * same way), selected in main.ts.
 */
import type { Effect } from 'effect'

export type Titler = (text: string) => Effect.Effect<string | null>
