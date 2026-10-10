import { Markdown } from '@/components/custom/markdown'
import {
  PlainStreamText,
  StreamingText,
  StreamingTurnStatus,
  type StreamTextRenderer,
} from '@/components/custom/streaming_text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Message, MessageContent, MessageGroup } from '@/components/ui/message'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pressProps } from '@/lib/press'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Streamdown } from 'streamdown'

import '../index.css'
import { createPlaybackClock } from './clock'
import { createDeliverySimulation, type DeliveryMode } from './delivery'
import { createStreamEngine, projectStream, type StreamRecording } from './engine'
import { recordings } from './fixtures'

function ExistingMarkdown(text: string) {
  return <Markdown>{text}</Markdown>
}

function StreamdownCandidate(text: string) {
  return (
    <Streamdown isAnimating={false} controls={false} className='text-sm leading-relaxed'>
      {text}
    </Streamdown>
  )
}

const renderers: readonly { title: string; render: StreamTextRenderer }[] = [
  { title: 'Plain text baseline', render: PlainStreamText },
  { title: 'Existing Markdown · settled', render: ExistingMarkdown },
  { title: 'Streamdown · no animation', render: StreamdownCandidate },
]

function Replay({ recording }: { recording: StreamRecording }) {
  const [clock] = useState(() => createPlaybackClock(recording))
  const playback = useSyncExternalStore(clock.subscribe, clock.snapshot)
  const [mode, setMode] = useState<DeliveryMode>('batched')
  const engine = useMemo(() => {
    const next = createStreamEngine()
    next.admit(recording.inputs)
    return next
  }, [recording])
  const simulation = useMemo(() => createDeliverySimulation(recording, mode), [recording, mode])
  const delivered = useMemo(
    () => simulation.advance(playback.cursor),
    [simulation, playback.cursor]
  )
  const semantic = engine.at(playback.cursor)
  const presentation = projectStream(semantic, playback.cursor, recording)
  const agrees = JSON.stringify(semantic) === JSON.stringify(delivered.semantic)

  useEffect(() => {
    if (!playback.playing) return
    let frame: number
    function tick(nowMs: number) {
      clock.tick(nowMs)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [clock, playback.playing])

  return (
    <>
      <section
        aria-label='Playback controls'
        className='sticky top-0 z-10 flex flex-col gap-4 bg-background py-4'
      >
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            {...pressProps(() =>
              playback.playing ? clock.pause(performance.now()) : clock.play(performance.now())
            )}
          >
            {playback.playing ? 'Pause' : 'Play'}
          </Button>
          <Button
            variant='outline'
            disabled={playback.cursor.eventCount === 0}
            {...pressProps(() => clock.step(-1))}
          >
            Previous event
          </Button>
          <Button
            variant='outline'
            disabled={playback.cursor.eventCount === recording.inputs.length}
            {...pressProps(() => clock.step(1))}
          >
            Next event
          </Button>
          <Button variant='outline' {...pressProps(() => clock.seek(0))}>
            Start
          </Button>
          <Button variant='outline' {...pressProps(() => clock.seek(recording.durationMs))}>
            End
          </Button>
          <ToggleGroup
            aria-label='Playback speed'
            variant='outline'
            value={[String(playback.speed)]}
          >
            {[0.25, 1, 2].map((speed) => (
              <ToggleGroupItem
                key={speed}
                value={String(speed)}
                {...pressProps(() => clock.speed(speed, performance.now()))}
              >
                <span className='font-mono'>{speed}×</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className='font-mono text-sm' data-playback-cursor>
            {Math.round(playback.cursor.atMs)}ms · {playback.cursor.eventCount}/
            {recording.inputs.length}
          </span>
        </div>
        <Slider
          aria-label='Recording time'
          value={playback.cursor.atMs}
          min={0}
          max={recording.durationMs}
          step={1}
          onValueChange={(value) => clock.seek(Array.isArray(value) ? value[0]! : value)}
        />
        <div className='flex flex-wrap items-center gap-3'>
          <ToggleGroup aria-label='Simulated delivery' variant='outline' value={[mode]}>
            <ToggleGroupItem value='batched' {...pressProps(() => setMode('batched'))}>
              Batched live
            </ToggleGroupItem>
            <ToggleGroupItem value='catch-up' {...pressProps(() => setMode('catch-up'))}>
              Catch-up
            </ToggleGroupItem>
          </ToggleGroup>
          <Badge variant={agrees ? 'secondary' : 'destructive'}>
            {agrees ? 'Replay and live agree' : 'Delivery mismatch'}
          </Badge>
          <span className='text-xs text-muted-foreground'>
            <span className='font-mono'>{delivered.batches}</span> batches ·{' '}
            <span className='font-mono'>{delivered.duplicates}</span> duplicate inputs ignored
          </span>
        </div>
        <StreamingTurnStatus presentation={presentation} />
        <Separator />
      </section>
      <div className='grid items-start gap-6 lg:grid-cols-3'>
        {renderers.map(({ title, render }) => (
          <section key={title} aria-label={title} className='flex min-w-0 flex-col gap-4'>
            <h2 className='text-sm font-medium'>{title}</h2>
            <MessageGroup>
              {presentation.texts.map((item) => (
                <Message key={item.id}>
                  <MessageContent>
                    <StreamingText item={item} renderText={render} />
                  </MessageContent>
                </Message>
              ))}
            </MessageGroup>
          </section>
        ))}
      </div>
      <Separator className='my-6' />
      <section aria-label='Input journal' className='flex flex-col gap-3'>
        <h2 className='text-sm font-medium'>Ordered synthetic input</h2>
        <p className='text-xs text-muted-foreground'>
          The journal intentionally shows future input for inspection; the presentation above only
          receives the selected prefix.
        </p>
        <ol className='flex flex-col gap-1 text-sm'>
          {recording.inputs.map((input) => (
            <li
              key={input.seq}
              className={
                input.seq <= playback.cursor.eventCount
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              }
            >
              <span className='font-mono'>
                {input.seq} · {input.atMs}ms · {input.event.type}
              </span>
              {input.seq === playback.cursor.eventCount && ' ← cursor'}
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

function StreamingReplay() {
  const [recording, setRecording] = useState(recordings[0]!)
  return (
    <main className='mx-auto flex max-w-7xl flex-col gap-4 p-6'>
      <header className='flex flex-col gap-2'>
        <h1 className='text-xl font-semibold'>Streaming replay</h1>
        <p className='text-sm text-muted-foreground'>
          Synthetic timings only. Immediate observed text; no pacing or production renderer choice.
        </p>
      </header>
      <ToggleGroup aria-label='Load synthetic recording' variant='outline' value={[recording.id]}>
        {recordings.map((fixture) => (
          <ToggleGroupItem
            key={fixture.id}
            value={fixture.id}
            onClick={() => setRecording(fixture)}
          >
            {fixture.title}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Replay key={recording.id} recording={recording} />
      <p className='text-xs text-muted-foreground'>
        A snapshot or retained whole-message transcript cannot recover original deltas or timing. No
        private conversations, provider calls or recorder are used here. Rendering candidates are
        not stream authorities.
      </p>
    </main>
  )
}

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<StreamingReplay />)
