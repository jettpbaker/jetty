import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pressHandlers } from '@/lib/press-handlers'
import { ArrowCounterClockwiseIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react'
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

// Fake a long, bursty agent stream and try a few ways to smooth the harsh
// "blink in" of raw token dumps. Lab only — not wired to the real timeline.

const SCRIPT = `The reconnect race is real. On socket open we fire \`thread.subscribe\` before the hello ack lands, so the first catch-up patch is dropped and the UI sits on a stale \`lastSeq\`.

Here's the fix path:

1. **Gate subscriptions on hello** — don't open a thread until the server has confirmed the connection.
2. **Re-request catch-up after every open** — always resume from the client's last known seq, even if the socket never fully died.
3. **Coalesce bursts** — SSE deltas arrive in clumps; batch apply on a ~16ms tick so React doesn't thrash on every token.

While we're here, the tool timeline needs the same kind of restraint. Consecutive reads and greps should fold into one “gathered context” row. Bash and edits stay first-class — those are high signal. Pending tools only shimmer a title; paths and args wait until the call settles so the list doesn't thrash mid-stream.

Streaming text itself is the other half. Models dump tokens in uneven bursts: a quiet stretch, then a whole clause at once. Showing every arrival raw looks like a strobe. A few ways to soften that:

- **Pace the reveal** — let the UI lag the buffer by a few hundred characters and catch up at punctuation.
- **Fade the tail** — new words arrive at low opacity and ease to full strength.
- **Blur settle** — the fresh edge starts slightly soft, then snaps sharp.
- **Soft lift** — new segments rise a couple of pixels as they solidify.
- **Heat tail** — the newest span keeps a warm tint that cools into body text.

None of these should fight \`prefers-reduced-motion\`. If the user asked for less motion, fall back to paced or raw with no transforms.

I'll land the socket fix first, then the denser tool chrome, then pick a stream smoothing default from this lab once you've kicked the tires.`

type StreamMode = 'raw' | 'fade' | 'blur' | 'lift' | 'heat' | 'paced' | 'word'

const MODES: Array<{ id: StreamMode; label: string; blurb: string }> = [
  {
    id: 'raw',
    label: 'Raw',
    blurb: 'Tokens land instantly — the harsh blink baseline.',
  },
  {
    id: 'fade',
    label: 'Fade tail',
    blurb: 'Only the fresh edge fades in; settled text is one plain node.',
  },
  {
    id: 'blur',
    label: 'Blur settle',
    blurb: 'Tail starts soft and sharpens; body stays unfiltered plain text.',
  },
  {
    id: 'lift',
    label: 'Soft lift',
    blurb: 'Tail rises a couple of pixels while fading; settled body is static.',
  },
  {
    id: 'heat',
    label: 'Heat tail',
    blurb: 'Newest edge glows warm, then merges into plain body color.',
  },
  {
    id: 'paced',
    label: 'Paced',
    blurb: 'UI reveals slower than arrivals; snaps to punctuation when close.',
  },
  {
    id: 'word',
    label: 'Word cascade',
    blurb: 'Words fade in on the tail only; completed words collapse to plain text.',
  },
]

type Speed = 0.5 | 1 | 2

const SPEEDS: Speed[] = [0.5, 1, 2]

// Split into realistic agent chunks: words, spaces, punctuation, newlines.
function tokenize(text: string): string[] {
  const parts = text.match(/\S+\s*|\s+/g)
  return parts ?? [text]
}

function chunkPlan(text: string): string[] {
  const tokens = tokenize(text)
  const chunks: string[] = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    // Occasionally emit a multi-token burst (models dump clauses).
    if (token.trim().length > 0 && Math.random() < 0.28 && i + 1 < tokens.length) {
      const burst = 1 + Math.floor(Math.random() * 3)
      chunks.push(tokens.slice(i, i + burst).join(''))
      i += burst
      continue
    }
    // Rarely split a long word into smaller pieces.
    if (token.trim().length > 8 && Math.random() < 0.18) {
      const bare = token.trimEnd()
      const space = token.slice(bare.length)
      const mid = Math.max(2, Math.floor(bare.length * (0.35 + Math.random() * 0.3)))
      chunks.push(bare.slice(0, mid))
      chunks.push(bare.slice(mid) + space)
      i += 1
      continue
    }
    chunks.push(token)
    i += 1
  }
  return chunks
}

function nextDelayMs(chunk: string, speed: Speed): number {
  const trimmed = chunk.trim()
  let base = 18 + Math.random() * 42
  if (trimmed.length === 0) base = 8 + Math.random() * 12
  if (/[.!?]$/.test(trimmed)) base += 140 + Math.random() * 180
  else if (/[,;:]$/.test(trimmed)) base += 40 + Math.random() * 60
  else if (chunk.includes('\n\n')) base += 200 + Math.random() * 160
  else if (chunk.includes('\n')) base += 70 + Math.random() * 80
  // Occasional thinking pause.
  if (Math.random() < 0.04) base += 220 + Math.random() * 280
  return base / speed
}

type StreamChunk = {
  id: number
  text: string
  bornAt: number
}

type FakeStream = {
  chunks: StreamChunk[]
  buffer: string
  done: boolean
  playing: boolean
  startedAt: number | null
  replay: () => void
  toggle: () => void
}

function useFakeStream(speed: Speed, active: boolean): FakeStream {
  const plan = useMemo(() => chunkPlan(SCRIPT), [])
  const [runId, setRunId] = useState(0)
  const [chunks, setChunks] = useState<StreamChunk[]>([])
  const [playing, setPlaying] = useState(true)
  const [done, setDone] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const indexRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const idRef = useRef(0)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const replay = useCallback(() => {
    clearTimer()
    indexRef.current = 0
    idRef.current = 0
    setChunks([])
    setDone(false)
    setPlaying(true)
    setStartedAt(null)
    setRunId((n) => n + 1)
  }, [clearTimer])

  const toggle = useCallback(() => {
    if (done) {
      replay()
      return
    }
    setPlaying((p) => !p)
  }, [done, replay])

  useEffect(() => {
    if (!active || !playing || done) {
      clearTimer()
      return
    }

    function tick() {
      const i = indexRef.current
      if (i >= plan.length) {
        setDone(true)
        setPlaying(false)
        return
      }
      const text = plan[i]!
      indexRef.current = i + 1
      const id = idRef.current++
      const bornAt = performance.now()
      setStartedAt((prev) => prev ?? Date.now())
      setChunks((prev) => [...prev, { id, text, bornAt }])
      timerRef.current = window.setTimeout(tick, nextDelayMs(text, speed))
    }

    timerRef.current = window.setTimeout(tick, 80 / speed)
    return clearTimer
  }, [active, playing, done, plan, speed, runId, clearTimer])

  const buffer = useMemo(() => chunks.map((c) => c.text).join(''), [chunks])

  return { chunks, buffer, done, playing, startedAt, replay, toggle }
}

// --- reveal modes -----------------------------------------------------------

// Smoothing only applies to the fresh edge. Once a chunk's age passes
// settleMs it merges into a single plain-text prefix — no per-token spans
// for the whole message.
const SETTLE_MS = 420
const HEAT_SETTLE_MS = 700
const WORD_SETTLE_MS = 380
// Hard cap so a stalled animation can't leave hundreds of live nodes.
const MAX_TAIL_CHUNKS = 28
const MAX_TAIL_WORDS = 40

function useNow(active: boolean, fps = 30): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = 0
    const interval = 1000 / fps
    function loop(t: number) {
      if (t - last >= interval) {
        last = t
        setNow(t)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active, fps])
  return now
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function splitTail<T extends { bornAt: number }>(
  items: T[],
  now: number,
  settleMs: number,
  maxTail: number
): { settledCount: number; tail: T[] } {
  let split = items.length
  for (let i = 0; i < items.length; i++) {
    if (now - items[i]!.bornAt < settleMs) {
      split = i
      break
    }
  }
  if (items.length - split > maxTail) {
    split = items.length - maxTail
  }
  return { settledCount: split, tail: items.slice(split) }
}

function TailReveal({
  chunks,
  styleFor,
  settleMs = SETTLE_MS,
}: {
  chunks: StreamChunk[]
  styleFor: (age: number, text: string) => CSSProperties
  settleMs?: number
}) {
  const reduced = prefersReducedMotion()
  const last = chunks[chunks.length - 1]
  const needsClock =
    !reduced && !!last && performance.now() - last.bornAt < settleMs + 48
  const now = useNow(needsClock)

  if (reduced) {
    return <StreamBody>{chunks.map((c) => c.text).join('')}</StreamBody>
  }

  const { settledCount, tail } = splitTail(chunks, now, settleMs, MAX_TAIL_CHUNKS)
  const settled = chunks
    .slice(0, settledCount)
    .map((c) => c.text)
    .join('')

  return (
    <StreamBody>
      {settled}
      {tail.map((chunk) => {
        const age = Math.max(0, now - chunk.bornAt)
        return (
          <span key={chunk.id} style={styleFor(age, chunk.text)}>
            {chunk.text}
          </span>
        )
      })}
    </StreamBody>
  )
}

function fadeStyle(age: number, _text: string): CSSProperties {
  const t = Math.min(1, age / SETTLE_MS)
  const eased = 1 - (1 - t) ** 3
  return { opacity: eased }
}

function blurStyle(age: number, _text: string): CSSProperties {
  const t = Math.min(1, age / SETTLE_MS)
  const eased = 1 - (1 - t) ** 3
  return {
    opacity: 0.35 + eased * 0.65,
    filter: `blur(${((1 - eased) * 2.2).toFixed(2)}px)`,
  }
}

function liftStyle(age: number, text: string): CSSProperties {
  const t = Math.min(1, age / (SETTLE_MS + 80))
  const eased = 1 - (1 - t) ** 3
  // inline-block on pure whitespace collapses wrapping — only lift real glyphs.
  if (!text.trim()) return { opacity: eased }
  return {
    opacity: eased,
    display: 'inline-block',
    transform: `translateY(${((1 - eased) * 4).toFixed(2)}px)`,
  }
}

function heatStyle(age: number, _text: string): CSSProperties {
  const t = Math.min(1, age / HEAT_SETTLE_MS)
  const eased = 1 - (1 - t) ** 2
  const warmth = Math.round((1 - eased) * 100)
  return {
    color:
      warmth <= 0
        ? undefined
        : `color-mix(in oklch, var(--foreground) ${100 - warmth}%, oklch(0.78 0.12 75) ${warmth}%)`,
  }
}

// Paced reveal: visible length lags the buffer, advances on a ticker.
function usePacedText(buffer: string, streaming: boolean): string {
  const [visible, setVisible] = useState('')
  const visibleRef = useRef('')
  const bufferRef = useRef(buffer)
  bufferRef.current = buffer

  // Replay / shrink: snap visible back down with the buffer.
  useEffect(() => {
    if (buffer.length < visibleRef.current.length || !buffer.startsWith(visibleRef.current)) {
      visibleRef.current = buffer
      setVisible(buffer)
    }
  }, [buffer])

  useEffect(() => {
    let raf = 0
    let last = performance.now()

    function step(size: number, from: string, to: string): string {
      if (to.length <= from.length) return to
      if (!to.startsWith(from)) return to
      const lag = to.length - from.length
      if (lag <= 48) return to
      let next = Math.min(from.length + size, to.length)
      const window = to.slice(from.length, next + 12)
      const snap = window.search(/[\s.,;:!?)\]]/)
      if (snap >= 0 && from.length + snap + 1 <= to.length) {
        next = from.length + snap + 1
      }
      return to.slice(0, next)
    }

    function tick(now: number) {
      const target = bufferRef.current
      const current = visibleRef.current
      const elapsed = now - last
      if (elapsed >= 24) {
        last = now
        const lag = target.length - current.length
        const size = lag > 240 ? 14 : lag > 120 ? 8 : lag > 48 ? 4 : 2
        const next = streaming ? step(size, current, target) : target
        if (next !== current) {
          visibleRef.current = next
          setVisible(next)
        }
      }
      if (streaming || visibleRef.current !== bufferRef.current) {
        raf = requestAnimationFrame(tick)
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [streaming])

  return visible
}

function PacedReveal({ buffer, streaming }: { buffer: string; streaming: boolean }) {
  const text = usePacedText(buffer, streaming)
  return <StreamBody>{text}</StreamBody>
}

// Word cascade: promote completed words from the buffer; animate each word.
type WordPiece = { id: number; text: string; bornAt: number }

function useWordPieces(chunks: StreamChunk[]): WordPiece[] {
  return useMemo(() => {
    const full = chunks.map((c) => c.text).join('')
    // Split keeping whitespace attached to preceding word when possible.
    const parts = full.match(/\S+\s*|\s+/g) ?? []
    // Birth time: use the chunk that completed this word (last chunk whose
    // cumulative length covers the word end).
    let cursor = 0
    const ends: number[] = []
    for (const chunk of chunks) {
      cursor += chunk.text.length
      ends.push(cursor)
    }
    let offset = 0
    const pieces: WordPiece[] = []
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i]!
      offset += text.length
      // Find first chunk end that covers this offset.
      let bornAt = chunks[0]?.bornAt ?? 0
      for (let c = 0; c < ends.length; c++) {
        if (ends[c]! >= offset) {
          bornAt = chunks[c]!.bornAt
          break
        }
      }
      pieces.push({ id: i, text, bornAt })
    }
    return pieces
  }, [chunks])
}

function WordReveal({ chunks }: { chunks: StreamChunk[] }) {
  const pieces = useWordPieces(chunks)
  const reduced = prefersReducedMotion()
  const last = pieces[pieces.length - 1]
  const needsClock =
    !reduced && !!last && performance.now() - last.bornAt < WORD_SETTLE_MS + 48
  const now = useNow(needsClock)

  if (reduced) {
    return <StreamBody>{pieces.map((p) => p.text).join('')}</StreamBody>
  }

  const { settledCount, tail } = splitTail(pieces, now, WORD_SETTLE_MS, MAX_TAIL_WORDS)
  const settled = pieces
    .slice(0, settledCount)
    .map((p) => p.text)
    .join('')

  return (
    <StreamBody>
      {settled}
      {tail.map((piece) => {
        const age = Math.max(0, now - piece.bornAt)
        const t = Math.min(1, age / WORD_SETTLE_MS)
        const eased = 1 - (1 - t) ** 3
        return (
          <span
            key={piece.id}
            style={{
              opacity: eased,
              filter: t < 1 ? `blur(${((1 - eased) * 1.4).toFixed(2)}px)` : undefined,
            }}
          >
            {piece.text}
          </span>
        )
      })}
    </StreamBody>
  )
}

function StreamBody({ children }: { children: ReactNode }) {
  return (
    <div className='text-sm leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]'>
      {children}
    </div>
  )
}

function StreamRenderer({
  mode,
  chunks,
  buffer,
  streaming,
}: {
  mode: StreamMode
  chunks: StreamChunk[]
  buffer: string
  streaming: boolean
}) {
  switch (mode) {
    case 'raw':
      return <StreamBody>{buffer}</StreamBody>
    case 'fade':
      return <TailReveal chunks={chunks} styleFor={fadeStyle} />
    case 'blur':
      return <TailReveal chunks={chunks} styleFor={blurStyle} />
    case 'lift':
      return <TailReveal chunks={chunks} styleFor={liftStyle} />
    case 'heat':
      return <TailReveal chunks={chunks} styleFor={heatStyle} settleMs={HEAT_SETTLE_MS} />
    case 'paced':
      return <PacedReveal buffer={buffer} streaming={streaming} />
    case 'word':
      return <WordReveal chunks={chunks} />
  }
}

function formatElapsed(startedAt: number | null, done: boolean, playing: boolean): string {
  if (startedAt === null) return '0.0s'
  // freeze display when paused/done via re-render from parent tick
  void done
  void playing
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
}

function useElapsedLabel(startedAt: number | null, done: boolean, playing: boolean): string {
  const [label, setLabel] = useState('0.0s')
  useEffect(() => {
    if (startedAt === null) {
      setLabel('0.0s')
      return
    }
    function update() {
      setLabel(formatElapsed(startedAt, done, playing))
    }
    update()
    if (!playing && done) return
    if (!playing) return
    const id = window.setInterval(update, 100)
    return () => window.clearInterval(id)
  }, [startedAt, done, playing])
  return label
}

export function StreamingLab() {
  const [mode, setMode] = useState<StreamMode>('fade')
  const [speed, setSpeed] = useState<Speed>(1)
  const stream = useFakeStream(speed, true)
  const elapsed = useElapsedLabel(stream.startedAt, stream.done, stream.playing)
  const activeMode = MODES.find((m) => m.id === mode)!

  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-8 p-8'>
      <header className='flex flex-col gap-2'>
        <h1 className='text-2xl font-semibold tracking-tight'>Streaming lab</h1>
        <p className='max-w-2xl text-sm text-muted-foreground'>
          Same fake agent transcript, different reveal treatments. Motion modes only style the
          fresh edge — settled text collapses to one plain node so long replies stay cheap.
        </p>
      </header>

      <div className='flex flex-col gap-3'>
        <div className='flex flex-wrap gap-1.5'>
          {MODES.map((m) => {
            const selected = m.id === mode
            return (
              <button
                key={m.id}
                type='button'
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  selected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                )}
                {...pressHandlers(() => setMode(m.id))}
              >
                {m.label}
              </button>
            )
          })}
        </div>
        <p className='text-sm text-muted-foreground'>{activeMode.blurb}</p>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='outline'
          size='sm'
          {...pressHandlers(stream.toggle)}
        >
          {stream.done ? (
            <>
              <ArrowCounterClockwiseIcon />
              Replay
            </>
          ) : stream.playing ? (
            <>
              <PauseIcon />
              Pause
            </>
          ) : (
            <>
              <PlayIcon />
              Resume
            </>
          )}
        </Button>
        <Button variant='ghost' size='sm' {...pressHandlers(stream.replay)}>
          <ArrowCounterClockwiseIcon />
          Restart
        </Button>

        <div className='mx-1 h-4 w-px bg-border' />

        <span className='text-xs text-muted-foreground'>speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type='button'
            className={cn(
              'rounded-md px-2 py-1 font-mono text-xs transition-colors',
              speed === s
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            {...pressHandlers(() => setSpeed(s))}
          >
            {s}×
          </button>
        ))}

        <div className='min-w-0 flex-1' />

        <span className='font-mono text-[11px] text-muted-foreground'>
          {stream.done ? 'done' : stream.playing ? 'streaming' : 'paused'}
          {' · '}
          {stream.buffer.length} chars
          {' · '}
          {elapsed}
        </span>
      </div>

      <div>
        <StreamRenderer
          mode={mode}
          chunks={stream.chunks}
          buffer={stream.buffer}
          streaming={stream.playing && !stream.done}
        />
        {!stream.buffer && (
          <p className='text-sm text-muted-foreground/60'>Waiting for first tokens…</p>
        )}
      </div>
    </div>
  )
}
