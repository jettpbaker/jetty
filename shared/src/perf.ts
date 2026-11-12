export const perfKinds = ['journey', 'loaf', 'event', 'shift', 'ws', 'snapshot'] as const

// One field timing record, as the client writes it, the server's sink stores it and the lab reads it.
export type PerfRecord = {
  v: 1
  t: number
  sid: string
  k: (typeof perfKinds)[number]
  n: string
  d?: number
  jid?: string
  a?: Record<string, number | string | boolean>
}
