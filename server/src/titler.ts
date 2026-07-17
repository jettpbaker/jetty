/**
 * The title-generation seam, provider-agnostic like the Agent seam: the
 * orchestrator only knows this shape. Each provider ships its own
 * implementation (createClaudeTitler today; a codex/ACP titler slots in the
 * same way), selected in main.ts.
 */
export type Titler = (text: string) => Promise<string | null>
