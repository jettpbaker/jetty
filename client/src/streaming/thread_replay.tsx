import { ThreadList } from '@/components/custom/thread_list'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { loadAccent } from '@/lib/accent'
import { pressProps } from '@/lib/press'
import { applyTheme } from '@/lib/theme'
import { chromeSnapshotAtom } from '@/state/chrome'
import { StateProvider } from '@/state/provider'
import { foldUpdate, noteCompleted } from '@/state/threads'
import { ThreadEvent } from '@jetty/shared/events'
import { emptyThread } from '@jetty/shared/reducer'
import { Schema } from 'effect'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'

import '../index.css'
import '../accent.css'
import { createPlaybackClock } from './clock'
import { loadRecording } from './engine'
import { RecordedPreview } from './recorded_preview'

const Preview = Schema.Struct({
  version: Schema.Literal(1),
  recordingId: Schema.String,
  title: Schema.String,
  src: Schema.Literal('/streaming-replay.local/preview.webm'),
  fps: Schema.Finite.check(Schema.isGreaterThan(0)),
  frameCount: Schema.Int.check(Schema.isGreaterThan(0)),
  duration: Schema.Finite.check(Schema.isGreaterThan(0)),
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  height: Schema.Int.check(Schema.isGreaterThan(0)),
  capturedAt: Schema.String,
  sourceRevision: Schema.String,
})

const ThreadRecording = Schema.Struct({
  wallAnchor: Schema.Int,
  projectPath: Schema.optional(Schema.String),
  provider: Schema.String,
  prompt: Schema.optional(Schema.String),
  bookmarks: Schema.optional(
    Schema.Array(
      Schema.Struct({
        label: Schema.String,
        atMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      })
    )
  ),
  recording: Schema.Unknown,
})

function readRecording(value: unknown) {
  const metadata = Schema.decodeUnknownSync(ThreadRecording)(value)
  let recording = loadRecording(metadata.recording)
  if (metadata.bookmarks?.some((bookmark) => bookmark.atMs >= recording.durationMs))
    throw new Error('Replay bookmark is outside the recording')
  for (const input of recording.inputs) Schema.decodeUnknownSync(ThreadEvent)(input.event)
  const firstTurn = recording.inputs.find((input) => input.event.type === 'turn.started')?.event
  if (
    firstTurn?.type === 'turn.started' &&
    !recording.inputs.some(
      ({ event }) =>
        event.type === 'item.started' &&
        event.item.kind === 'user_message' &&
        event.item.turnId === firstTurn.turnId
    )
  ) {
    recording = {
      ...recording,
      inputs: [
        {
          seq: 1,
          atMs: 0,
          event: {
            type: 'item.started',
            item: {
              kind: 'user_message',
              id: `${recording.id}:prompt`,
              turnId: firstTurn.turnId,
              createdAt: metadata.wallAnchor,
              text: metadata.prompt ?? 'Original prompt was not recorded.',
              attachments: [],
            },
          },
        },
        ...recording.inputs.map((input) => ({ ...input, seq: input.seq + 1 })),
      ],
    }
  }
  return { ...metadata, recording }
}

type Recording = ReturnType<typeof readRecording>

// Only item timestamps move to this playback's wall clock; tool inputs and outputs stay intact.
function replayEvent(
  input: Recording['recording']['inputs'][number],
  offset: number,
  identity: string
) {
  const event = Schema.decodeUnknownSync(ThreadEvent)(input.event)
  if (event.type === 'item.started') {
    return {
      ...event,
      item: {
        ...event.item,
        id: `${identity}:${event.item.id}`,
        ...(event.item.agentId && { agentId: `${identity}:${event.item.agentId}` }),
        ...(event.item.kind === 'approval' &&
          event.item.toolCallId && {
            toolCallId: `${identity}:${event.item.toolCallId}`,
          }),
        createdAt: event.item.createdAt + offset,
        ...(event.item.completedAt !== undefined && {
          completedAt: event.item.completedAt + offset,
        }),
      },
    }
  }
  if (event.type === 'item.updated' || event.type === 'item.completed') {
    const patch = { ...event.patch }
    for (const key of ['createdAt', 'completedAt'] as const)
      if (typeof patch[key] === 'number') patch[key] += offset
    return { ...event, itemId: `${identity}:${event.itemId}`, patch }
  }
  if (event.type === 'item.delta') return { ...event, itemId: `${identity}:${event.itemId}` }
  return event
}

function parsePlaybackTime(value: string) {
  const match = /^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim())
  if (!match || (match[1] !== undefined && Number(match[2]) >= 60)) return
  const milliseconds =
    (Number(match[1] ?? 0) * 60 + Number(match[2])) * 1000 + Number((match[3] ?? '').padEnd(3, '0'))
  return Number.isFinite(milliseconds) ? milliseconds : undefined
}

function formatPlaybackTime(atMs: number) {
  const seconds = Math.floor(atMs / 1000)
  const fraction = String(atMs % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}${fraction ? `.${fraction}` : ''}`
}

function Replay({
  source,
  capture = false,
  startMs = 0,
  autoPlay = false,
  onJump,
}: {
  source: Recording
  capture?: boolean
  startMs?: number
  autoPlay?: boolean
  onJump: (atMs: number) => void
}) {
  const { recording } = source
  const [clock] = useState(() => {
    const clock = createPlaybackClock(recording)
    if (startMs > 0) clock.seek(startMs)
    return clock
  })
  const playback = useSyncExternalStore(clock.subscribe, clock.snapshot)
  const [identity] = useState(() => crypto.randomUUID())
  const [anchor, setAnchor] = useState(() => Date.now() - startMs)
  const [thread, setThread] = useState(emptyThread)
  const current = useRef(emptyThread)
  const live = useRef(false)
  const [startTime, setStartTime] = useState(() => formatPlaybackTime(startMs))
  const jumpMs = parsePlaybackTime(startTime)
  const validJump = jumpMs !== undefined && jumpMs < recording.durationMs

  useEffect(() => {
    if (!capture) return
    function play() {
      live.current = true
      setAnchor(Date.now())
      clock.play(performance.now())
    }
    window.addEventListener('jetty:capture-play', play)
    return () => window.removeEventListener('jetty:capture-play', play)
  }, [capture, clock])

  useEffect(() => {
    let state = current.current
    for (const input of recording.inputs.slice(state.lastSeq, playback.cursor.eventCount)) {
      const event = replayEvent(input, anchor - source.wallAnchor, identity)
      state = foldUpdate(state, {
        type: 'event',
        seq: input.seq,
        ts: anchor + Math.round(input.atMs),
        event,
      })
      if (live.current && event.type === 'item.completed') noteCompleted(event.itemId)
    }
    current.current = state
    setThread(state)
  }, [recording, source.wallAnchor, anchor, identity, playback.cursor.eventCount, playback.playing])

  useEffect(() => {
    if (!autoPlay || capture) return
    live.current = true
    clock.play(performance.now())
  }, [autoPlay, capture, clock])

  useEffect(() => {
    if (!playback.playing) return
    let frame: number
    function tick(now: number) {
      clock.tick(now)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [clock, playback.playing])

  return (
    <div
      className='contents'
      data-capture-state={
        playback.playing
          ? 'playing'
          : thread.lastSeq === recording.inputs.length
            ? 'complete'
            : 'ready'
      }
      data-recording-id={recording.id}
      data-recording-title={recording.title}
      data-duration-ms={recording.durationMs}
    >
      {!capture && (
        <div className='flex flex-wrap items-center gap-3 px-6 py-3'>
          <Button
            size='sm'
            disabled={playback.playing || playback.cursor.atMs > startMs}
            {...pressProps(() => {
              live.current = true
              setAnchor(Date.now() - startMs)
              clock.play(performance.now())
            })}
          >
            Play real timing
          </Button>
          <form
            className='flex items-center gap-2'
            onSubmit={(event) => {
              event.preventDefault()
              if (validJump) onJump(jumpMs)
            }}
          >
            <InputGroup className='h-7 w-44'>
              <InputGroupAddon>
                <label htmlFor='replay-start'>Start at</label>
              </InputGroupAddon>
              <InputGroupInput
                id='replay-start'
                className='h-full font-mono'
                placeholder='m:ss'
                value={startTime}
                aria-invalid={!validJump || undefined}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </InputGroup>
            <Button type='submit' size='sm' variant='outline' disabled={!validJump}>
              Jump & play
            </Button>
          </form>
          {source.bookmarks?.map((bookmark) => (
            <Button
              key={`${bookmark.label}:${bookmark.atMs}`}
              size='sm'
              variant='outline'
              {...pressProps(() => onJump(bookmark.atMs))}
            >
              {bookmark.label} · {formatPlaybackTime(bookmark.atMs)}
            </Button>
          ))}
          <Button
            size='sm'
            variant='outline'
            disabled={playback.playing}
            {...pressProps(() => clock.seek(recording.durationMs))}
          >
            Show completed
          </Button>
          <span className='font-mono text-xs text-muted-foreground' data-playback-cursor>
            {(playback.cursor.atMs / 1000).toFixed(1)}s / {(recording.durationMs / 1000).toFixed(1)}
            s · {playback.cursor.eventCount}/{recording.inputs.length}
          </span>
        </div>
      )}
      <ThreadList
        threadId={`replay-${identity}`}
        items={thread.items}
        status={thread.status}
        running={thread.activeTurnId !== null}
        outcomes={thread.turnOutcomes}
        loadouts={thread.turnLoadouts}
        projectPath={source.projectPath}
        provider={source.provider}
      />
    </div>
  )
}

function App({
  source,
  preview,
  capture,
}: {
  source: Recording
  preview?: Schema.Schema.Type<typeof Preview>
  capture: boolean
}) {
  const [run, setRun] = useState({ id: 0, startMs: 0, autoPlay: false })
  const [view, setView] = useState(preview ? 'recorded' : 'live')
  function jump(atMs: number) {
    setRun((current) => ({ id: current.id + 1, startMs: atMs, autoPlay: true }))
  }
  return (
    <StateProvider initialValues={[[chromeSnapshotAtom, { projects: [], threads: [], bots: [] }]]}>
      <TooltipProvider>
        <main className='flex h-dvh flex-col'>
          {!capture && (
            <header className='flex flex-wrap items-center gap-3 border-b px-6 py-3'>
              <h1 className='text-sm font-medium'>Production thread replay</h1>
              <p className='flex-1 text-xs text-muted-foreground'>{source.recording.title}</p>
              <ToggleGroup
                size='sm'
                variant='outline'
                value={[view]}
                onValueChange={(value) => {
                  if (value[0]) setView(value[0])
                }}
                aria-label='Preview mode'
              >
                <ToggleGroupItem value='recorded'>Recorded</ToggleGroupItem>
                <ToggleGroupItem value='live'>Live</ToggleGroupItem>
              </ToggleGroup>
              {view === 'live' && (
                <Button size='sm' variant='outline' {...pressProps(() => jump(run.startMs))}>
                  Restart
                </Button>
              )}
            </header>
          )}
          {!capture && view === 'live' && (
            <p className='px-6 pt-3 text-xs text-muted-foreground'>
              Original server-observed timing, at 1×. Production thread components and event
              reducer. Missing user prompts are represented by a placeholder at playback start.
            </p>
          )}
          {capture || view === 'live' ? (
            <Replay
              key={run.id}
              source={source}
              capture={capture}
              startMs={run.startMs}
              autoPlay={run.autoPlay}
              onJump={jump}
            />
          ) : preview ? (
            <RecordedPreview preview={preview} />
          ) : (
            <div className='flex flex-1 flex-col items-center justify-center gap-2 p-6'>
              <p className='text-sm'>No recorded preview yet.</p>
              <p className='text-xs text-muted-foreground'>
                Run <code className='font-mono'>bun run replay:capture</code> to record this replay.
              </p>
            </div>
          )}
        </main>
      </TooltipProvider>
    </StateProvider>
  )
}

if (import.meta.env.DEV) {
  applyTheme()
  document.documentElement.dataset.accent = loadAccent()
  const files = import.meta.glob(
    ['/streaming-replay.local/thread.json', '/streaming-replay.local/preview.json'],
    {
      eager: true,
      import: 'default',
    }
  )
  const value = files['/streaming-replay.local/thread.json']
  const root = createRoot(document.getElementById('root')!)
  try {
    if (!value) throw new Error('No local thread recording. See docs/thread-replay.md.')
    const source = readRecording(value)
    const manifest = files['/streaming-replay.local/preview.json']
    let preview: Schema.Schema.Type<typeof Preview> | undefined
    if (manifest) {
      try {
        const decoded = Schema.decodeUnknownSync(Preview)(manifest)
        if (decoded.recordingId === source.recording.id) preview = decoded
      } catch {
        preview = undefined
      }
    }
    // This browser-only dev entry uses a URL flag independently of the app platform.
    // oxlint-disable-next-line no-restricted-properties
    const capture = new URLSearchParams(window.location.search).has('capture')
    root.render(<App source={source} preview={preview} capture={capture} />)
  } catch (error) {
    root.render(<p role='alert'>{error instanceof Error ? error.message : 'Invalid recording'}</p>)
  }
}
