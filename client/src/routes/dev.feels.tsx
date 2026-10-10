import type { ThreadState } from '@jetty/shared/reducer'

import { PauseIcon, PlayIcon, Refresh01Icon } from '@/components/custom/huge_icons'
import { SettingsSegmented, SettingsSelect } from '@/components/custom/settings_layout'
import { ThreadList } from '@/components/custom/thread_list'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ChatFeelContext, chatFeelNames, chatFeels, pinRootChatFeel } from '@/lib/chat-feel'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'
import { foldUpdate, noteCompleted } from '@/state'
import { ThreadEvent } from '@jetty/shared/events'
import { emptyThread } from '@jetty/shared/reducer'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { useEffect, useRef, useState } from 'react'

// An experiment: one real transcript replayed at its real speed into four threads at once, each
// in a chat feel of its own, to compare how they feel.
export const Route = createFileRoute('/dev/feels')({ component: Feels })

type Replay = {
  title: string
  provider?: string
  projectPath?: string
  events: { t: number; event: ThreadEvent }[]
}
type ReplayFile = Omit<Replay, 'events'> & { events: { t: number; event: unknown }[] }

// Threads exported by scripts/export-replay.ts, their events decoded as the wire decodes them.
const decode = Schema.decodeUnknownSync(ThreadEvent)
const files = import.meta.glob<ReplayFile>('../dev/replays/*.json', {
  eager: true,
  import: 'default',
})
const replays = new Map(
  Object.entries(files).map(([path, replay]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
    { ...replay, events: replay.events.map(({ t, event }) => ({ t, event: decode(event) })) },
  ])
)
const names = [...replays.keys()]
const speeds = ['0.25', '0.5', '1', '2'] as const
type Speed = (typeof speeds)[number]

const tickKinds = {
  user_message: { label: 'User message', color: 'bg-sky-500' },
  reasoning: { label: 'Thinking', color: 'bg-violet-500' },
  tool_call: { label: 'Tool call', color: 'bg-amber-500' },
  assistant_message: { label: 'Assistant text', color: 'bg-emerald-500' },
} as const

function eventTicks(replay: Replay) {
  const kinds = new Map<string, keyof typeof tickKinds>()
  return replay.events.flatMap(({ t, event }, index) => {
    if (event.type === 'item.started' && event.item.kind in tickKinds)
      kinds.set(event.item.id, event.item.kind as keyof typeof tickKinds)
    const kind =
      event.type === 'item.started'
        ? kinds.get(event.item.id)
        : 'itemId' in event
          ? kinds.get(event.itemId)
          : undefined
    return kind ? [{ t, index, ...tickKinds[kind] }] : []
  })
}

const ticks = new Map([...replays].map(([name, replay]) => [name, eventTicks(replay)]))

function Feels() {
  // Restarting or picking another transcript mounts every pane afresh.
  const [pick, setPick] = useState({ name: names[0]!, run: 0 })
  const [speed, setSpeed] = useState<Speed>('1')
  useEffect(() => pinRootChatFeel(), [])
  return (
    <FeelReplay
      key={pick.run}
      run={pick.run}
      name={pick.name}
      speed={speed}
      onSpeed={setSpeed}
      onPick={(name) => setPick(({ run }) => ({ name, run: run + 1 }))}
      onRestart={() => setPick(({ name, run }) => ({ name, run: run + 1 }))}
    />
  )
}

// Each event lands stamped with the time it lands, so durations and ages read as they did live.
function land(state: ThreadState, event: ThreadEvent, seq: number, ts = Date.now()) {
  if (event.type === 'item.completed') noteCompleted(event.itemId)
  return foldUpdate(state, {
    type: 'event',
    seq,
    ts,
    event:
      event.type === 'item.started' ? { ...event, item: { ...event.item, createdAt: ts } } : event,
  })
}

function clockText(ms: number) {
  const seconds = ms / 1000
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

function FeelReplay({
  run,
  name,
  speed,
  onSpeed,
  onPick,
  onRestart,
}: {
  run: number
  name: string
  speed: Speed
  onSpeed: (speed: Speed) => void
  onPick: (name: string) => void
  onRestart: () => void
}) {
  const replay = replays.get(name)!
  const duration = replay.events.at(-1)!.t
  const [thread, setThread] = useState(emptyThread)
  const [playing, setPlaying] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [seekRun, setSeekRun] = useState(0)
  // One clock for all four panes: replay time, and the next event due.
  const clock = useRef({ at: 0, next: 0, thread: emptyThread })

  useEffect(() => {
    if (!playing) return
    const { events } = replay
    const playhead = clock.current
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      playhead.at = Math.min(duration, playhead.at + Math.max(0, now - last) * Number(speed))
      last = now
      let state = playhead.thread
      while (playhead.next < events.length && events[playhead.next]!.t <= playhead.at) {
        state = land(state, events[playhead.next]!.event, playhead.next + 1)
        playhead.next++
      }
      if (state !== playhead.thread) {
        playhead.thread = state
        setThread(state)
      }
      setElapsed(playhead.at === duration ? duration : Math.floor(playhead.at / 100) * 100)
      if (playhead.next < events.length) frame = requestAnimationFrame(tick)
      else setPlaying(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, replay, duration, speed])

  function seek(at: number) {
    setPlaying(false)
    at = Math.max(0, Math.min(duration, at))
    let state = emptyThread
    let next = 0
    const start = Date.now() - at
    for (const { t, event } of replay.events) {
      if (t > at) break
      state = land(state, event, next + 1, start + t)
      next++
    }
    clock.current = { at, next, thread: state }
    setThread(state)
    setElapsed(at)
    setSeekRun((value) => value + 1)
  }

  function playPause() {
    if (playing) setPlaying(false)
    else if (clock.current.next < replay.events.length) setPlaying(true)
    else onRestart()
  }

  // As the thread page reads it: running while a turn is live, idle once it completes.
  const running =
    thread.status === 'starting' ||
    thread.status === 'awaiting_approval' ||
    (thread.status === 'running' && thread.activeTurnId !== null)

  return (
    <div className='fixed inset-0 z-50 flex flex-col bg-background'>
      <div className='grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-px bg-border'>
        {chatFeels.map((feel, index) => (
          <section
            key={`${feel}-${seekRun}`}
            data-chat-feel={feel}
            aria-label={chatFeelNames[feel]}
            className='flex min-h-0 min-w-0 flex-col bg-background'
          >
            <h2 className='flex h-8 shrink-0 items-center border-b px-3 text-xs font-medium text-muted-foreground'>
              {'ABCD'[index]} · {chatFeelNames[feel]}
            </h2>
            <ChatFeelContext value={feel}>
              <ThreadList
                threadId={`replay-${run}-${feel}`}
                items={thread.items}
                status={thread.status}
                running={running}
                outcomes={thread.turnOutcomes}
                loadouts={thread.turnLoadouts}
                projectPath={replay.projectPath}
                provider={replay.provider}
                onSelectAgent={() => undefined}
              />
            </ChatFeelContext>
          </section>
        ))}
      </div>
      <div className='flex h-10 shrink-0 items-center gap-1 border-t px-2'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={playing ? 'Pause' : 'Play'}
          {...pressProps(playPause)}
        >
          {playing ? <PauseIcon filled /> : <PlayIcon filled />}
        </Button>
        <Button variant='ghost' size='icon-sm' aria-label='Restart' onClick={onRestart}>
          <Refresh01Icon />
        </Button>
        <div className='flex-1' />
        <SettingsSegmented
          label='Speed'
          value={speed}
          options={speeds.map((value) => ({ value, label: `${value}×` }))}
          onChange={onSpeed}
        />
        <SettingsSelect
          label='Transcript'
          value={name}
          options={names.map((value) => ({ value, label: value }))}
          onChange={onPick}
        />
      </div>
      <section aria-label='Replay timeline' className='flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3'>
        <div className='flex items-center justify-between gap-3 text-xs text-muted-foreground'>
          <span className='font-mono tabular-nums'>
            {clockText(elapsed)} / {clockText(duration)}
          </span>
          <span>← / → 100ms · Shift 1s</span>
        </div>
        <div className='relative'>
          <Slider
            aria-label='Replay playhead'
            aria-valuetext={clockText(elapsed)}
            min={0}
            max={duration}
            step={1}
            thumbAlignment='center'
            value={elapsed}
            onPointerDownCapture={() => setPlaying(false)}
            onValueChange={(value) => seek(Array.isArray(value) ? value[0]! : value)}
            onKeyDownCapture={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              event.stopPropagation()
              seek(
                clock.current.at +
                  (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1000 : 100)
              )
            }}
          />
          <div
            aria-hidden
            className='pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2'
          >
            {ticks.get(name)!.map(({ t, index, label, color }) => (
              <span
                key={index}
                title={`${label} · ${clockText(t)}`}
                className={cn('absolute h-full w-px', color)}
                style={{ left: `${duration ? (t / duration) * 100 : 0}%` }}
              />
            ))}
          </div>
        </div>
        <div className='flex flex-wrap gap-3 text-xs text-muted-foreground'>
          {Object.values(tickKinds).map(({ label, color }) => (
            <span key={label} className='flex items-center gap-1.5'>
              <span className={cn('h-2 w-1 rounded-sm', color)} />
              {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
