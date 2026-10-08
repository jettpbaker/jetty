import type { RecallHit } from './lib'
import type { SearchThread, ThreadUpdate, ThreadCursor } from './threads'
import type { recallThreads } from './threads'

export type Request = { id: number; botId: string } & (
  | { kind: 'cursors' }
  | { kind: 'wiki'; home: string; query: string; k: number }
  | { kind: 'threads'; scope: SearchThread[]; updates: ThreadUpdate[]; query: string; k: number }
)
export type Reply =
  | { type: 'ready' }
  | { type: 'progress'; percent: number }
  | { type: 'loadError'; error: string }
  | {
      type: 'result'
      id: number
      result?:
        | Record<string, ThreadCursor>
        | RecallHit[]
        | Awaited<ReturnType<typeof recallThreads>>
      error?: string
    }
