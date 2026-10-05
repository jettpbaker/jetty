import type { SubagentStatus } from '@jetty/shared/items'

// C1's timings (sketchpad /components/subagent-finish), shared by the thread's subagent tabs and the
// hover card's subagent rows; subagent_finish.css has the motion.
export type Ended = Exclude<SubagentStatus, 'running'>

export const beatMs: Record<Ended, number> = { completed: 500, failed: 900, stopped: 300 }
export const exitMs = 260
export const reducedExitMs = 150
