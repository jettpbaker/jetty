import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ThreadEvent } from '@jetty/shared/events'

export type CaptureMetadata = {
  threadId: string
  scenario: string
  sdkVersion: string
  normalizerVersion: string
  fidelity: 'synthetic' | 'server-observed'
}

export type CaptureRecord = {
  v: 1
  seq: number
  atMs: number
  kind: 'header' | 'source' | 'translation' | 'output' | 'lifecycle' | 'gap' | 'footer'
  data: Record<string, unknown>
}

type CaptureLimits = { queueBytes: number; recordBytes: number; totalBytes: number }

export type ClaudeCapture = ReturnType<typeof createClaudeCapture>

export function createClaudeCapture(input: {
  metadata: CaptureMetadata
  write: (line: string) => Promise<void>
  limits?: Partial<CaptureLimits>
}) {
  const limits = {
    queueBytes: 4 * 1024 * 1024,
    recordBytes: 2 * 1024 * 1024,
    totalBytes: 64 * 1024 * 1024,
    ...input.limits,
  }
  const anchor = performance.now()
  const wallAnchor = new Date().toISOString()
  const queue: string[] = []
  let seq = 0
  let sourceSeq = 0
  let queuedBytes = 0
  let totalBytes = 0
  let writtenRecords = 0
  let writing: Promise<void> | undefined
  let closed = false
  let writeFailed = false
  let incompleteReason: string | undefined
  let gap: { firstSeq: number; lastSeq: number; reason: string } | undefined

  function markGap(n: number, reason: string) {
    if (gap) {
      gap.firstSeq = Math.min(gap.firstSeq, n)
      gap.lastSeq = Math.max(gap.lastSeq, n)
      if (reason === 'write_failed') gap.reason = reason
    } else gap = { firstSeq: n, lastSeq: n, reason }
  }

  function drain() {
    if (writing || writeFailed) return
    writing = Promise.resolve()
      .then(async () => {
        while (queue.length) {
          const line = queue[0]!
          try {
            await input.write(line)
          } catch {
            writeFailed = true
            markGap(JSON.parse(line).seq, 'write_failed')
            if (gap) gap.lastSeq = seq
            queue.length = 0
            queuedBytes = 0
            break
          }
          queue.shift()
          queuedBytes -= Buffer.byteLength(line)
          writtenRecords++
        }
      })
      .finally(() => {
        writing = undefined
        if (queue.length) drain()
      })
  }

  function record(
    kind: CaptureRecord['kind'],
    data: Record<string, unknown>,
    terminal = false,
    atMs = performance.now() - anchor
  ) {
    if (closed && !terminal) return
    const n = ++seq
    if (writeFailed || (gap && !terminal)) {
      markGap(n, writeFailed ? 'write_failed' : gap!.reason)
      return
    }
    let line: string
    try {
      line = `${JSON.stringify({ v: 1, seq: n, atMs, kind, data } satisfies CaptureRecord)}\n`
    } catch {
      markGap(n, 'serialization_failed')
      return
    }
    const bytes = Buffer.byteLength(line)
    if (!terminal) {
      const reason =
        bytes > limits.recordBytes
          ? 'record_limit'
          : queuedBytes + bytes > limits.queueBytes
            ? 'queue_limit'
            : totalBytes + bytes > limits.totalBytes
              ? 'total_limit'
              : null
      if (reason) {
        markGap(n, reason)
        return
      }
    }
    queue.push(line)
    queuedBytes += bytes
    totalBytes += bytes
    drain()
  }

  async function flush() {
    while (writing) await writing
  }

  record('header', {
    ...input.metadata,
    wallAnchor,
    segmentId: crypto.randomUUID(),
    runtime: `bun ${Bun.version}`,
    timing:
      'SDK iterator receipt and pre-persistence server publication; not provider generation or browser time',
    limits,
    sourcePolicy:
      'stream_event, assistant, user, result, tool_progress and scoped status/compact/reset/task envelopes; reduced init; other envelopes explicitly excluded',
  })

  return {
    source(threadId: string, turnId: string, message: SDKMessage) {
      if (threadId !== input.metadata.threadId || closed) return undefined
      const atMs = performance.now() - anchor
      const n = ++sourceSeq
      const approved =
        ['stream_event', 'assistant', 'user', 'result', 'tool_progress'].includes(message.type) ||
        (message.type === 'system' &&
          [
            'status',
            'compact_boundary',
            'conversation_reset',
            'task_started',
            'task_notification',
            'task_progress',
            'task_updated',
            'background_tasks_changed',
          ].includes(message.subtype))
      const init = message.type === 'system' && message.subtype === 'init'
      record(
        'source',
        {
          sourceSeq: n,
          turnId,
          ...(approved
            ? { message }
            : init
              ? {
                  message: {
                    type: message.type,
                    subtype: message.subtype,
                    uuid: message.uuid,
                    session_id: message.session_id,
                    claude_code_version: message.claude_code_version,
                    model: message.model,
                    permissionMode: message.permissionMode,
                    effort: message.effort,
                  },
                  omitted: 'init configuration and authentication fields',
                }
              : {
                  excluded: true,
                  type: message.type,
                  ...(message.type === 'system' ? { subtype: message.subtype } : {}),
                }),
        },
        false,
        atMs
      )
      return n
    },
    translation(threadId: string, turnId: string, n: number | undefined, events: ThreadEvent[]) {
      if (threadId === input.metadata.threadId)
        record('translation', { turnId, sourceSeq: n ?? null, events })
    },
    output(threadId: string, turnId: string, event: ThreadEvent, n?: number) {
      if (threadId === input.metadata.threadId)
        record('output', { turnId, sourceSeq: n ?? null, event })
    },
    lifecycle(
      threadId: string,
      turnId: string,
      name: string,
      context: Record<string, unknown> = {}
    ) {
      if (threadId === input.metadata.threadId) record('lifecycle', { turnId, name, ...context })
    },
    flush,
    async stop(reason?: string) {
      if (closed) {
        await flush()
        return
      }
      incompleteReason = reason
      closed = true
      await flush()
      if (gap) record('gap', { ...gap }, true)
      record(
        'footer',
        {
          complete: !gap && !writeFailed && !incompleteReason,
          incompleteReason: incompleteReason ?? null,
          sourceCount: sourceSeq,
          writtenRecords,
        },
        true
      )
      await flush()
    },
    status() {
      return {
        closed,
        complete: closed && !gap && !writeFailed && !incompleteReason,
        incompleteReason: incompleteReason ?? null,
        sourceCount: sourceSeq,
        writtenRecords,
        gap,
      }
    },
  }
}
