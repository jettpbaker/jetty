import type { ThreadState } from '@jetty/shared/reducer'

import { PauseIcon, PlayIcon, Refresh01Icon } from '@/components/custom/huge_icons'
import { ReplayTimeline } from '@/components/custom/replay_timeline'
import { SettingsSegmented, SettingsSelect } from '@/components/custom/settings_layout'
import { ThreadList } from '@/components/custom/thread_list'
import { Button } from '@/components/ui/button'
import { frameMs, speedOptions, useTimeWarp } from '@/dev/time_warp'
import {
  TenseChangeContext,
  type TenseChange,
  BatchTenseContext,
  type BatchTense,
  ChatFeelContext,
  ChatSettledContext,
  LiveTurnContext,
  HybridLineContext,
  HybridPacingContext,
  type HybridPacing,
  InterimTextContext,
  type InterimText,
  type HybridLine,
  MorphDurationContext,
  type MorphDuration,
  pinRootChatFeel,
} from '@/lib/chat-feel'
import { pressProps } from '@/lib/press'
import { foldUpdate, noteCompleted } from '@/state'
import { ThreadEvent } from '@jetty/shared/events'
import { emptyThread } from '@jetty/shared/reducer'
import { createFileRoute, useLocation } from '@tanstack/react-router'
import { Schema } from 'effect'
import {
  type FocusEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import './dev.feels.css'

// A real transcript replayed at its real speed to inspect the Hybrid chat feel.
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

function Feels() {
  const search = useLocation({ select: (location) => location.searchStr })
  const scan = new URLSearchParams(search).get('scan')
  const timeWarp = useTimeWarp(scan !== null)
  // Restarting or picking another transcript mounts every pane afresh.
  const [pick, setPick] = useState({ name: scan && replays.has(scan) ? scan : names[0]!, run: 0 })
  const [tenseChange, setTenseChange] = useState<TenseChange>('smart')
  const [batchTense, setBatchTense] = useState<BatchTense>('open')
  const [hybridPacing, setHybridPacing] = useState<HybridPacing>('cursor')
  const [hybridLine, setHybridLine] = useState<HybridLine>('both')
  const [interimText, setInterimText] = useState<InterimText>('b')
  const [morphDuration, setMorphDuration] = useState<MorphDuration>('150')
  useEffect(() => pinRootChatFeel(), [])
  if (!timeWarp.ready) return null
  return (
    <FeelReplay
      key={pick.run}
      timeWarp={timeWarp}
      run={pick.run}
      name={pick.name}
      morphDuration={morphDuration}
      onMorphDuration={setMorphDuration}
      interimText={interimText}
      onInterimText={setInterimText}
      tenseChange={tenseChange}
      onTenseChange={setTenseChange}
      batchTense={batchTense}
      onBatchTense={setBatchTense}
      hybridPacing={hybridPacing}
      onHybridPacing={setHybridPacing}
      hybridLine={hybridLine}
      onHybridLine={setHybridLine}
      onPick={(name) => timeWarp.reset(() => setPick(({ run }) => ({ name, run: run + 1 })))}
      onRestart={() => timeWarp.reset(() => setPick(({ name, run }) => ({ name, run: run + 1 })))}
      onRebuild={() => setPick(({ name, run }) => ({ name, run: run + 1 }))}
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

// Controls never keep focus here, so Space and the arrow keys always drive the replay.
function dropControlFocus(event: FocusEvent<HTMLDivElement>) {
  const target = event.target
  if (
    target instanceof HTMLElement &&
    event.currentTarget.contains(target) &&
    target.matches('button, a, [role="button"], [role="radio"], [role="combobox"], [role="tab"]')
  )
    target.blur()
}

function FeelReplay({
  timeWarp,
  run,
  name,
  morphDuration,
  onMorphDuration,
  hybridLine,
  onHybridLine,
  tenseChange,
  onTenseChange,
  batchTense,
  onBatchTense,
  hybridPacing,
  onHybridPacing,
  interimText,
  onInterimText,
  onPick,
  onRestart,
  onRebuild,
}: {
  timeWarp: ReturnType<typeof useTimeWarp>
  run: number
  name: string
  morphDuration: MorphDuration
  onMorphDuration: (morphDuration: MorphDuration) => void
  interimText: InterimText
  onInterimText: (interimText: InterimText) => void
  tenseChange: TenseChange
  onTenseChange: (tenseChange: TenseChange) => void
  batchTense: BatchTense
  onBatchTense: (batchTense: BatchTense) => void
  hybridPacing: HybridPacing
  onHybridPacing: (hybridPacing: HybridPacing) => void
  hybridLine: HybridLine
  onHybridLine: (hybridLine: HybridLine) => void
  onPick: (name: string) => void
  onRestart: () => void
  onRebuild: () => void
}) {
  const replay = replays.get(name)!
  const duration = replay.events.at(-1)!.t
  const [thread, setThread] = useState(emptyThread)
  const [playing, setPlaying] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [settled, setSettled] = useState(false)
  const paneRef = useRef<HTMLElement>(null)
  const dragging = useRef(false)
  const settleFrame = useRef(0)

  useLayoutEffect(() => {
    for (const animation of paneRef.current!.getAnimations({ subtree: true })) {
      if (settled) {
        if (animation.effect?.getComputedTiming().iterations === Infinity) animation.pause()
        else animation.finish()
      } else if (animation.playState === 'paused') animation.play()
    }
  }, [settled, thread])
  useEffect(() => () => cancelAnimationFrame(settleFrame.current), [])

  const onSpace = useEffectEvent(playPause)
  const onStep = useEffectEvent((direction: number) => {
    if (!timeWarp.frozen) timeWarp.seekFrame(clock.current.at)
    void timeWarp.move(direction, onRebuild, playing)
  })
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        ![' ', '.', '>', ',', '<'].includes(event.key) ||
        (event.key === ' ' && event.repeat) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select') || target.isContentEditable)
      )
        return
      event.preventDefault()
      if (event.key === ' ') onSpace()
      else onStep(event.key === '.' || event.key === '>' ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  function releaseSettled() {
    cancelAnimationFrame(settleFrame.current)
    settleFrame.current = requestAnimationFrame(() => setSettled(false))
  }

  function scrubChange(active: boolean) {
    dragging.current = active
    if (!active) releaseSettled()
  }

  // Replay time and the next event due share the animation clock.
  const clock = useRef({ at: 0, next: 0, thread: emptyThread })

  useEffect(() => {
    if (!playing) return
    const { events } = replay
    const playhead = clock.current
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      playhead.at = Math.min(duration, playhead.at + Math.max(0, now - last))
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
  }, [playing, replay, duration])

  function seek(at: number) {
    setPlaying(false)
    at = Math.max(0, Math.min(duration, Math.round(at)))
    setSettled(true)
    cancelAnimationFrame(settleFrame.current)
    if (!dragging.current) releaseSettled()
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
    timeWarp.seekFrame(at)
  }

  // Pause freezes the whole page, mid-animation; Play thaws it and resumes the replay.
  function playPause() {
    if (playing && !timeWarp.frozen) {
      timeWarp.seekFrame(clock.current.at)
      return timeWarp.setFrozen(true)
    }
    timeWarp.setFrozen(false)
    if (playing) return
    if (clock.current.next < replay.events.length) {
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
    <div className='fixed inset-0 z-50 flex flex-col bg-background' onFocus={dropControlFocus}>
      <LiveTurnContext value='single'>
        <HybridLineContext value={hybridLine}>
          <InterimTextContext value={interimText}>
            <section
              ref={paneRef}
              data-chat-feel='hybrid'
              data-hybrid-line={hybridLine}
              data-chat-settled={settled ? '' : undefined}
              aria-label='Hybrid'
              className='flex min-h-0 flex-1 flex-col bg-background'
              style={timeWarp.rebuilding ? { opacity: 0 } : undefined}
            >
              <MorphDurationContext value={morphDuration}>
                <TenseChangeContext value={tenseChange}>
                  <ChatFeelContext value='hybrid'>
                    <BatchTenseContext value={batchTense}>
                      <HybridPacingContext value={hybridPacing}>
                        <ChatSettledContext value={settled}>
                          <ThreadList
                            threadId={`replay-${run}-hybrid`}
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
                      </HybridPacingContext>
                    </BatchTenseContext>
                  </ChatFeelContext>
                </TenseChangeContext>
              </MorphDurationContext>
            </section>
          </InterimTextContext>
        </HybridLineContext>
      </LiveTurnContext>
      <div className='flex h-10 shrink-0 items-center gap-1 border-t px-2'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={
            playing && !timeWarp.frozen
              ? 'Pause (Space; , / . step while paused)'
              : 'Play (Space; , previous frame / . next frame)'
          }
          {...pressProps(playPause)}
        >
          {playing && !timeWarp.frozen ? <PauseIcon filled /> : <PlayIcon filled />}
        </Button>
        <Button variant='ghost' size='icon-sm' aria-label='Restart' onClick={onRestart}>
          <Refresh01Icon />
        </Button>
        <div className='flex-1' />
        <SettingsSegmented
          label='Speed'
          value={timeWarp.speed}
          options={speedOptions}
          onChange={timeWarp.setSpeed}
        />
        <SettingsSelect
          label='Transcript'
          value={name}
          options={names.map((value) => ({ value, label: value }))}
          onChange={onPick}
        />
      </div>
      <div className='flex shrink-0 flex-wrap items-center gap-1 px-2 pb-2'>
        <div className='flex items-center gap-1'>
          <span className='text-xs text-muted-foreground'>Hybrid line:</span>
          <SettingsSegmented
            label='Hybrid line'
            value={hybridLine}
            options={[
              { value: 'today', label: 'Today' },
              { value: '2a', label: '2a' },
              { value: '2b', label: '2b' },
              { value: 'both', label: 'Both' },
            ]}
            onChange={onHybridLine}
          />
        </div>
        <div className='flex items-center gap-1'>
          <span className='text-xs text-muted-foreground'>Batch tense:</span>
          <SettingsSegmented
            label='Batch tense'
            value={batchTense}
            options={[
              { value: 'now', label: 'Now' },
              { value: 'open', label: 'Open' },
            ]}
            onChange={onBatchTense}
          />
        </div>
        <div className='flex items-center gap-1'>
          <span className='text-xs text-muted-foreground'>Tense change:</span>
          <SettingsSegmented
            label='Tense change'
            value={tenseChange}
            options={[
              { value: 'roll', label: 'Roll' },
              { value: 'torph', label: 'Torph' },
              { value: 'crossfade', label: 'Crossfade' },
              { value: 'smart', label: 'Smart' },
            ]}
            onChange={onTenseChange}
          />
        </div>
        <div className='flex items-center gap-1'>
          <span className='text-xs text-muted-foreground'>Morph:</span>
          <SettingsSegmented
            label='Morph'
            value={morphDuration}
            options={[
              { value: '150', label: '150' },
              { value: '300', label: '300' },
              { value: 'default', label: 'Default' },
            ]}
            onChange={onMorphDuration}
          />
        </div>
        <div className='flex items-center gap-1'>
          <span className='text-xs text-muted-foreground'>Hybrid pacing:</span>
          <SettingsSegmented
            label='Hybrid pacing'
            value={hybridPacing}
            options={[
              { value: 'none', label: 'None' },
              { value: 'cursor', label: 'Cursor' },
              { value: 'jetty', label: 'Jetty' },
            ]}
            onChange={onHybridPacing}
          />
        </div>
        <div className='flex items-center gap-1'>
          <span className='text-xs text-muted-foreground'>Interim text:</span>
          <SettingsSegmented
            label='Interim text'
            value={interimText}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ]}
            onChange={onInterimText}
          />
        </div>
      </div>
      <ReplayTimeline
        events={replay.events}
        duration={duration}
        elapsed={elapsed}
        playing={playing && !timeWarp.frozen}
        frame={
          timeWarp.frozen
            ? timeWarp.currentFrame
            : playing
              ? undefined
              : Math.round(elapsed / frameMs)
        }
        onSeek={seek}
        onScrubChange={scrubChange}
      />
    </div>
  )
}
