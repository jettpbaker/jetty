import { ThreadList } from '@/components/custom/thread_list'
import { Button } from '@/components/ui/button'
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
  recording: Schema.Unknown,
})

function readRecording(value: unknown) {
  const metadata = Schema.decodeUnknownSync(ThreadRecording)(value)
  let recording = loadRecording(metadata.recording)
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

function Replay({ source, capture = false }: { source: Recording; capture?: boolean }) {
  const { recording } = source
  const [clock] = useState(() => createPlaybackClock(recording))
  const playback = useSyncExternalStore(clock.subscribe, clock.snapshot)
  const [identity] = useState(() => crypto.randomUUID())
  const [anchor, setAnchor] = useState(Date.now)
  const [thread, setThread] = useState(emptyThread)
  const current = useRef(emptyThread)
  const live = useRef(false)

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
            disabled={playback.playing || playback.cursor.eventCount > 0}
            {...pressProps(() => {
              live.current = true
              setAnchor(Date.now())
              clock.play(performance.now())
            })}
          >
            Play real timing
          </Button>
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
        onSelectAgent={() => undefined}
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
  const [run, setRun] = useState(0)
  const [view, setView] = useState(preview ? 'recorded' : 'live')
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
                <Button size='sm' variant='outline' {...pressProps(() => setRun(run + 1))}>
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
            <Replay key={run} source={source} capture={capture} />
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
