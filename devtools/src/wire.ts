import type { ThreadEvent } from '@jetty/shared/events'

export type BotRow = {
  id: string
  name: string
  color: string
  provider: string
  model: string
  effort: string | null
  createdAt: number
  seenAt: number
}

export type ThreadRow = {
  id: string
  title: string
  parentId: string | null
  provider: string | null
  model: string | null
  sessionId: string | null
  status: string
  archived: boolean
}

export type EventRow = { threadId: string; seq: number; ts: number; event: ThreadEvent }

// One line of a Claude Code transcript, as written. `file` is the session id it came from.
export type TranscriptEntry = Record<string, unknown> & { type?: string; timestamp?: string }
export type TranscriptLine = { file: string; line: number; entry: TranscriptEntry }

export type Snapshot = {
  type: 'snapshot'
  bot: BotRow
  threads: ThreadRow[]
  events: EventRow[]
  transcript: TranscriptLine[]
  transcriptDir: string
}

export type Append = {
  type: 'append'
  threads?: ThreadRow[]
  events?: EventRow[]
  transcript?: TranscriptLine[]
}

export type StreamError = { type: 'error'; message: string }

export type StreamMessage = Snapshot | Append | StreamError
