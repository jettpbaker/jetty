import { markdownDefaults } from '@/components/response'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pressHandlers } from '@/lib/press-handlers'
import { ArrowCounterClockwiseIcon, CopyIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
// styles (+ blurIn override) come in via markdownDefaults' response.tsx import

// Streamdown 2.5's built-in per-word entrance animation over a fake stream
// paced like a real model. Lab only — not wired to the real timeline.

const SCRIPT = `The reconnect race is real. On socket open we fire \`thread.subscribe\` before the hello ack lands, so the first catch-up patch is dropped and the UI sits on a stale \`lastSeq\`.

Here's the fix path:

1. **Gate subscriptions on hello** — don't open a thread until the server has confirmed the connection.
2. **Re-request catch-up after every open** — always resume from the client's last known seq, even if the socket never fully died.
3. **Coalesce bursts** — deltas arrive in clumps; batch apply per frame so React doesn't thrash on every token.

The gate itself is small:

\`\`\`ts
socket.on('hello', () => {
  for (const threadId of openThreads) {
    send('thread.subscribe', { threadId, after: lastSeq(threadId) })
  }
})
\`\`\`

Code blocks are deliberately excluded from the word animation — Shiki repaints tokens as the fence grows, so fading them would double-flash. Prose animates; code streams plain.

While we're here, the tool timeline needs the same kind of restraint. Consecutive reads and greps should fold into one “gathered context” row. Bash and edits stay first-class — those are high signal. Pending tools only shimmer a title; paths and args wait until the call settles so the list doesn't thrash mid-stream.

I'll land the socket fix first, then the denser tool chrome, then we pick a default treatment from this lab once you've kicked the tires.`

// --- fake model stream ------------------------------------------------------

// ~BPE-ish pieces: leading whitespace rides with the token, long words split.
export function tokenize(text: string): string[] {
  return text.match(/\s*\S{1,5}|\s+/g) ?? [text]
}

// Rough output speeds as of mid-2026 (tok/s).
const PACES = [
  { label: 'Opus', tps: 40 },
  { label: 'Sonnet', tps: 80 },
  { label: 'Haiku', tps: 150 },
] as const

type Pace = (typeof PACES)[number]

function useFakeStream(pace: Pace) {
  const tokens = useMemo(() => tokenize(SCRIPT), [])
  const [runId, setRunId] = useState(0)
  const [buffer, setBuffer] = useState('')
  const [playing, setPlaying] = useState(true)
  const [done, setDone] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const indexRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const replay = useCallback(() => {
    clearTimer()
    indexRef.current = 0
    setBuffer('')
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
    if (!playing || done) {
      clearTimer()
      return
    }

    function tick(delay: number) {
      // Tokens owed for the elapsed gap — a stall flushes as a burst, the
      // way a buffered SSE stream catches up.
      const count = Math.max(1, Math.round((pace.tps * delay) / 1000))
      const i = indexRef.current
      if (i >= tokens.length) {
        setDone(true)
        setPlaying(false)
        return
      }
      const next = Math.min(tokens.length, i + count)
      indexRef.current = next
      setStartedAt((prev) => prev ?? Date.now())
      setBuffer((prev) => prev + tokens.slice(i, next).join(''))
      const stall = Math.random() < 0.03
      const nextDelay = stall ? 250 + Math.random() * 650 : 30 + Math.random() * 40
      timerRef.current = window.setTimeout(() => tick(nextDelay), nextDelay)
    }

    const first = 30 + Math.random() * 40
    timerRef.current = window.setTimeout(() => tick(first), first)
    return clearTimer
  }, [playing, done, tokens, pace, runId, clearTimer])

  return {
    runId,
    buffer,
    done,
    playing,
    startedAt,
    tokenCount: indexRef.current,
    replay,
    toggle,
  }
}

function useElapsedLabel(startedAt: number | null, running: boolean): string {
  const [label, setLabel] = useState('0.0s')
  useEffect(() => {
    if (startedAt === null) {
      setLabel('0.0s')
      return
    }
    function update() {
      setLabel(`${((Date.now() - startedAt!) / 1000).toFixed(1)}s`)
    }
    update()
    if (!running) return
    const id = window.setInterval(update, 100)
    return () => window.clearInterval(id)
  }, [startedAt, running])
  return label
}

// --- animation controls -----------------------------------------------------

const ANIMATIONS = [
  { id: 'off', label: 'Off' },
  { id: 'fadeIn', label: 'Fade' },
  { id: 'blurIn', label: 'Blur' },
  { id: 'slideUp', label: 'Slide up' },
] as const

type AnimationId = (typeof ANIMATIONS)[number]['id']

const EASINGS = ['ease', 'ease-out', 'linear'] as const

type Easing = (typeof EASINGS)[number]

type AnimConfig = {
  animation: AnimationId
  duration: number
  easing: Easing
  sep: 'word' | 'char'
  stagger: number
}

const DEFAULT_ANIM: AnimConfig = {
  animation: 'fadeIn',
  duration: 150,
  easing: 'ease-out',
  sep: 'word',
  stagger: 40,
}

const ANIM_SLIDERS = [
  { key: 'duration', label: 'duration', min: 0, max: 600 },
  { key: 'stagger', label: 'stagger', min: 0, max: 120 },
] as const

function Pills<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onSelect: (id: T) => void
}) {
  return (
    <div className='flex flex-wrap gap-1.5'>
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type='button'
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              selected
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
            )}
            {...pressHandlers(() => onSelect(option.id))}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function AnimControls({
  config,
  onChange,
}: {
  config: AnimConfig
  onChange: (next: AnimConfig) => void
}) {
  return (
    <div className='flex flex-col gap-2 font-mono text-[10px] text-muted-foreground'>
      <div className='grid max-w-md grid-cols-2 gap-x-6 gap-y-1'>
        {ANIM_SLIDERS.map((slider) => (
          <label key={slider.key} className='flex items-center gap-2'>
            <span className='w-14 shrink-0'>{slider.label}</span>
            <input
              type='range'
              min={slider.min}
              max={slider.max}
              value={config[slider.key]}
              onChange={(event) =>
                onChange({ ...config, [slider.key]: Number(event.currentTarget.value) })
              }
              className='min-w-0 flex-1'
            />
            <span className='w-8 shrink-0 text-right text-foreground'>{config[slider.key]}</span>
          </label>
        ))}
      </div>
      <div className='flex items-center gap-3'>
        <label className='flex items-center gap-2'>
          <span>easing</span>
          {EASINGS.map((easing) => (
            <button
              key={easing}
              type='button'
              className={cn(
                'rounded-md px-1.5 py-0.5 transition-colors',
                config.easing === easing
                  ? 'bg-secondary text-foreground'
                  : 'hover:text-foreground'
              )}
              {...pressHandlers(() => onChange({ ...config, easing }))}
            >
              {easing}
            </button>
          ))}
        </label>
        <label className='flex items-center gap-2'>
          <span>sep</span>
          {(['word', 'char'] as const).map((sep) => (
            <button
              key={sep}
              type='button'
              className={cn(
                'rounded-md px-1.5 py-0.5 transition-colors',
                config.sep === sep ? 'bg-secondary text-foreground' : 'hover:text-foreground'
              )}
              {...pressHandlers(() => onChange({ ...config, sep }))}
            >
              {sep}
            </button>
          ))}
        </label>
        <button
          type='button'
          className='ml-auto flex items-center gap-1 hover:text-foreground'
          {...pressHandlers(() => {
            void navigator.clipboard.writeText(JSON.stringify(config, null, 2))
          })}
        >
          <CopyIcon className='size-3' />
          copy values
        </button>
      </div>
    </div>
  )
}

// --- lab --------------------------------------------------------------------

export function StreamingLab() {
  const [pace, setPace] = useState<Pace>(PACES[1])
  const [config, setConfig] = useState<AnimConfig>(DEFAULT_ANIM)
  const stream = useFakeStream(pace)
  const streaming = stream.playing && !stream.done
  const elapsed = useElapsedLabel(stream.startedAt, streaming)

  const animated = useMemo(() => {
    if (config.animation === 'off') return false
    const { animation, duration, easing, sep, stagger } = config
    return { animation, duration, easing, sep, stagger }
  }, [config])

  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-8 p-8'>
      <header className='flex flex-col gap-2'>
        <h1 className='text-2xl font-semibold tracking-tight'>Streaming lab</h1>
        <p className='max-w-2xl text-sm text-muted-foreground'>
          Streamdown&apos;s built-in per-word entrance animation, fed by a fake stream paced like
          a real model — jittered token batches with the occasional stall-and-burst. When the
          stream ends the word spans are dropped entirely.
        </p>
      </header>

      <div className='flex flex-col gap-3'>
        <Pills
          options={ANIMATIONS}
          value={config.animation}
          onSelect={(animation) => setConfig((c) => ({ ...c, animation }))}
        />
        <AnimControls config={config} onChange={setConfig} />
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button variant='outline' size='sm' {...pressHandlers(stream.toggle)}>
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

        <span className='text-xs text-muted-foreground'>pace</span>
        {PACES.map((p) => (
          <button
            key={p.label}
            type='button'
            className={cn(
              'rounded-md px-2 py-1 font-mono text-xs transition-colors',
              pace.label === p.label
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            {...pressHandlers(() => setPace(p))}
          >
            {p.label} ~{p.tps}
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

      <div className='text-sm leading-relaxed motion-reduce:[&_[data-sd-animate]]:animate-none'>
        <Streamdown
          {...markdownDefaults}
          key={stream.runId}
          animated={animated}
          isAnimating={streaming}
          className={cn(
            markdownDefaults.className,
            'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
          )}
        >
          {stream.buffer}
        </Streamdown>
        {!stream.buffer && (
          <p className='text-sm text-muted-foreground/60'>Waiting for first tokens…</p>
        )}
      </div>
    </div>
  )
}
