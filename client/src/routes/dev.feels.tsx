import type { ThreadState } from '@jetty/shared/reducer'

import { PauseIcon, PlayIcon, Refresh01Icon } from '@/components/custom/huge_icons'
import { ReplayTimeline } from '@/components/custom/replay_timeline'
import { SettingsSegmented, SettingsSelect } from '@/components/custom/settings_layout'
import { ThreadList } from '@/components/custom/thread_list'
import { Button } from '@/components/ui/button'
import {
  ChatFeelContext,
  ChatSettledContext,
  LiveTurnContext,
  WorkIndentContext,
  type WorkIndent,
  type LiveTurn,
  chatFeelNames,
  chatFeels,
  pinRootChatFeel,
} from '@/lib/chat-feel'
import { pressProps } from '@/lib/press'
import { foldUpdate, noteCompleted } from '@/state'
import { ThreadEvent } from '@jetty/shared/events'
import { emptyThread } from '@jetty/shared/reducer'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { useEffect, useRef, useState } from 'react'

import './dev.feels.css'

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

function Feels() {
  // Restarting or picking another transcript mounts every pane afresh.
  const [pick, setPick] = useState({ name: names[0]!, run: 0 })
  const [speed, setSpeed] = useState<Speed>('1')
  const [indent, setIndent] = useState<WorkIndent>('on')
  const [liveTurn, setLiveTurn] = useState<LiveTurn>('single')
  useEffect(() => pinRootChatFeel(), [])
  return (
    <FeelReplay
      key={pick.run}
      run={pick.run}
      name={pick.name}
      speed={speed}
      onSpeed={setSpeed}
      liveTurn={liveTurn}
      onLiveTurn={setLiveTurn}
      indent={indent}
      onIndent={setIndent}
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

function FeelReplay({
  run,
  name,
  speed,
  onSpeed,
  liveTurn,
  onLiveTurn,
  indent,
  onIndent,
  onPick,
  onRestart,
}: {
  run: number
  name: string
  speed: Speed
  onSpeed: (speed: Speed) => void
  liveTurn: LiveTurn
  onLiveTurn: (liveTurn: LiveTurn) => void
  indent: WorkIndent
  onIndent: (indent: WorkIndent) => void
  onPick: (name: string) => void
  onRestart: () => void
}) {
  const replay = replays.get(name)!
  const duration = replay.events.at(-1)!.t
  const [thread, setThread] = useState(emptyThread)
  const [playing, setPlaying] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [settled, setSettled] = useState(false)
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
    at = Math.max(0, Math.min(duration, Math.round(at)))
    setSettled(true)
    const playhead = clock.current
    const forward = at >= playhead.at
    let state = forward ? playhead.thread : emptyThread
    let next = forward ? playhead.next : 0
    const start = Date.now() - at
    while (next < replay.events.length && replay.events[next]!.t <= at) {
      const { t, event } = replay.events[next]!
      state = land(state, event, next + 1, start + t)
      next++
    }
    clock.current = { at, next, thread: state }
    setThread(state)
    setElapsed(at)
  }

  function playPause() {
    if (playing) setPlaying(false)
    else if (clock.current.next < replay.events.length) {
      setSettled(false)
      setPlaying(true)
    } else onRestart()
  }

  // As the thread page reads it: running while a turn is live, idle once it completes.
  const running =
    thread.status === 'starting' ||
    thread.status === 'awaiting_approval' ||
    (thread.status === 'running' && thread.activeTurnId !== null)

  return (
    <div className='fixed inset-0 z-50 flex flex-col bg-background'>
      <LiveTurnContext value={liveTurn}>
        <WorkIndentContext value={indent}>
          <div className='grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-px bg-border'>
            {chatFeels.map((feel, index) => (
              <section
                key={feel}
                data-chat-feel={feel}
                data-chat-settled={settled ? '' : undefined}
                aria-label={chatFeelNames[feel]}
                className='flex min-h-0 min-w-0 flex-col bg-background'
              >
                <h2 className='flex h-8 shrink-0 items-center border-b px-3 text-xs font-medium text-muted-foreground'>
                  {'ABCD'[index]} · {chatFeelNames[feel]}
                </h2>
                <ChatFeelContext value={feel}>
                  <ChatSettledContext value={settled}>
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
                  </ChatSettledContext>
                </ChatFeelContext>
              </section>
            ))}
          </div>
        </WorkIndentContext>
      </LiveTurnContext>
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
        <span className='text-xs text-muted-foreground'>Live turn:</span>
        <SettingsSegmented
          label='Live turn'
          value={liveTurn}
          options={[
            { value: 'split', label: 'Split' },
            { value: 'single', label: 'Single' },
          ]}
          onChange={onLiveTurn}
        />
        <span className='text-xs text-muted-foreground'>Indent:</span>
        <SettingsSegmented
          label='Indent'
          value={indent}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={onIndent}
        />
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
      <ReplayTimeline
        events={replay.events}
        duration={duration}
        elapsed={elapsed}
        playing={playing}
        onSeek={seek}
      />
    </div>
  )
}
