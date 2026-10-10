import { PauseIcon, PlayIcon, Refresh01Icon } from '@/components/custom/huge_icons'
import { HybridV2Pane } from '@/components/custom/hybrid_v2'
import { ReplayTimeline } from '@/components/custom/replay_timeline'
import { SettingsSegmented, SettingsSelect } from '@/components/custom/settings_layout'
import { ThreadList } from '@/components/custom/thread_list'
import { threadRows } from '@/components/custom/thread_rows'
import { describeToolBatch } from '@/components/custom/work_model'
import { Button } from '@/components/ui/button'
import { landReplayEvent as land } from '@/dev/replay_event'
import { frameMs, speedOptions, useTimeWarp } from '@/dev/time_warp'
import {
  HybridRowsContext,
  type HybridRows,
  TenseChangeContext,
  type TenseChange,
  BatchLabelContext,
  type BatchLabel,
  BatchTenseContext,
  type BatchTense,
  WorkLiftContext,
  type WorkLift,
  ChatFeelContext,
  ChatSettledContext,
  LiveTurnContext,
  HybridFoldContext,
  type HybridFold,
  HybridLineContext,
  HybridPacingContext,
  type HybridPacing,
  InterimTextContext,
  type InterimText,
  type HybridLine,
  FadeDurationContext,
  type FadeDuration,
  pinRootChatFeel,
} from '@/lib/chat-feel'
import { pressProps } from '@/lib/press'
import { ThreadEvent } from '@jetty/shared/events'
import { emptyThread } from '@jetty/shared/reducer'
import { createFileRoute, Link, useLocation } from '@tanstack/react-router'
import { Schema } from 'effect'
import {
  type FocusEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

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
  const params = new URLSearchParams(search)
  const [engine, setEngine] = useState<'today' | 'v2'>(
    params.get('engine') === 'today' ? 'today' : 'v2'
  )
  const scan = params.get('scan')
  const fold = params.get('fold')
  const timeWarp = useTimeWarp(scan !== null)
  // Restarting or picking another transcript mounts every pane afresh.
  const [pick, setPick] = useState({ name: scan && replays.has(scan) ? scan : names[0]!, run: 0 })
  const [tenseChange, setTenseChange] = useState<TenseChange>(
    params.get('tenseChange') === 'opencode' || params.get('tenseChange') === 'roll'
      ? (params.get('tenseChange') as TenseChange)
      : 'crossfade'
  )
  const [rows, setRows] = useState<HybridRows>(
    params.get('rows') === 'instant' ? 'instant' : 'animate'
  )
  const [batchLabel, setBatchLabel] = useState<BatchLabel>(
    params.get('batchLabel') === 'each' || params.get('batchLabel') === 'count'
      ? (params.get('batchLabel') as BatchLabel)
      : 'hold'
  )
  const [batchTense, setBatchTense] = useState<BatchTense>('open')
  const [lift, setLift] = useState<WorkLift>('off')
  const [hybridFold, setHybridFold] = useState<HybridFold>(
    fold === 'overlap' || fold === 'first' ? fold : 'after-reveal'
  )
  const [hybridPacing, setHybridPacing] = useState<HybridPacing>('cursor')
  const [hybridLine, setHybridLine] = useState<HybridLine>('both')
  const [interimText, setInterimText] = useState<InterimText>('b')
  const [fadeDuration, setFadeDuration] = useState<FadeDuration>('300')
  useEffect(() => pinRootChatFeel(), [])
  if (!timeWarp.ready) return null
  return (
    <FeelReplay
      key={pick.run}
      engine={engine}
      onEngine={(value) => {
        setEngine(value)
        const next = new URLSearchParams(search)
        next.set('engine', value)
        window.history.replaceState(null, '', `/dev/feels?${next}`)
      }}
      timeWarp={timeWarp}
      run={pick.run}
      name={pick.name}
      fadeDuration={fadeDuration}
      onFadeDuration={setFadeDuration}
      interimText={interimText}
      onInterimText={setInterimText}
      rows={rows}
      onRows={setRows}
      tenseChange={tenseChange}
      onTenseChange={setTenseChange}
      batchLabel={batchLabel}
      onBatchLabel={setBatchLabel}
      batchTense={batchTense}
      onBatchTense={setBatchTense}
      lift={lift}
      onLift={setLift}
      hybridFold={hybridFold}
      onHybridFold={setHybridFold}
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
  engine,
  onEngine,
  timeWarp,
  run,
  name,
  fadeDuration,
  onFadeDuration,
  hybridLine,
  onHybridLine,
  rows,
  onRows,
  tenseChange,
  onTenseChange,
  batchLabel,
  onBatchLabel,
  batchTense,
  onBatchTense,
  lift,
  onLift,
  hybridFold,
  onHybridFold,
  hybridPacing,
  onHybridPacing,
  interimText,
  onInterimText,
  onPick,
  onRestart,
  onRebuild,
}: {
  engine: 'today' | 'v2'
  onEngine: (engine: 'today' | 'v2') => void
  timeWarp: ReturnType<typeof useTimeWarp>
  run: number
  name: string
  fadeDuration: FadeDuration
  onFadeDuration: (fadeDuration: FadeDuration) => void
  interimText: InterimText
  onInterimText: (interimText: InterimText) => void
  rows: HybridRows
  onRows: (rows: HybridRows) => void
  tenseChange: TenseChange
  onTenseChange: (tenseChange: TenseChange) => void
  batchLabel: BatchLabel
  onBatchLabel: (batchLabel: BatchLabel) => void
  batchTense: BatchTense
  onBatchTense: (batchTense: BatchTense) => void
  lift: WorkLift
  onLift: (lift: WorkLift) => void
  hybridFold: HybridFold
  onHybridFold: (hybridFold: HybridFold) => void
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
  const replayStart = useRef(Date.now())
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
    if (engine === 'v2') return
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
    const scanWindow = window as typeof window & { __feelReplay?: () => unknown }
    scanWindow.__feelReplay = () => {
      const playhead = clock.current
      const open = new Set<string>()
      for (const { event } of replay.events.slice(0, playhead.next)) {
        if (
          event.type === 'item.started' &&
          (event.item.kind === 'tool_call' || event.item.kind === 'reasoning')
        )
          open.add(event.item.id)
        if (event.type === 'item.completed') open.delete(event.itemId)
      }
      const activities = threadRows(playhead.thread.items, {
        status: playhead.thread.status,
        running: true,
        projectPath: replay.projectPath,
      }).flatMap((row) => (row.kind === 'work' ? row.activities : []))
      return {
        ms: Number(playhead.at.toFixed(1)),
        running: activities.flatMap((activity) => {
          if (!open.has(activity.id)) return []
          if (activity.type === 'thinking')
            return [{ id: activity.id, label: 'Thinking', counted: '' }]
          if (activity.type !== 'tool') return []
          const call = { ...activity, status: 'running' as const }
          const label = describeToolBatch({
            type: 'tools',
            id: call.id,
            calls: [call],
            sealed: false,
          })
          const counted = describeToolBatch(
            { type: 'tools', id: call.id, calls: [call, call], sealed: false },
            true,
            true
          )
          return [
            {
              id: call.id,
              label: label.description ?? `${label.verb} ${label.target}`,
              counted: `${counted.verb} ${counted.target}`.replace('2 ', '{count} '),
            },
          ]
        }),
      }
    }
    return () => {
      delete scanWindow.__feelReplay
    }
  }, [replay])

  useEffect(() => {
    if (!playing) return
    const { events } = replay
    const playhead = clock.current
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      if (engine === 'v2' && playhead !== clock.current) return
      playhead.at = Math.min(duration, playhead.at + Math.max(0, now - last))
      last = now
      let state = playhead.thread
      while (playhead.next < events.length && events[playhead.next]!.t <= playhead.at) {
        const { t, event } = events[playhead.next]!
        state = land(
          state,
          event,
          playhead.next + 1,
          engine === 'v2' ? replayStart.current + t : undefined
        )
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
  }, [playing, replay, duration, engine])

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
    const start = engine === 'v2' ? replayStart.current : Date.now() - at
    while (next < replay.events.length && replay.events[next]!.t <= at) {
      const { t, event } = replay.events[next]!
      state = land(state, event, next + 1, start + t)
      next++
    }
    clock.current = { at, next, thread: state }
    if (engine === 'v2') {
      flushSync(() => {
        setThread(state)
        setElapsed(at)
        setSettled(true)
      })
    } else {
      setThread(state)
      setElapsed(at)
    }
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
              data-engine={engine}
              data-hybrid-line={hybridLine}
              data-hybrid-fold={hybridFold}
              data-chat-settled={settled ? '' : undefined}
              aria-label='Hybrid'
              className='flex min-h-0 flex-1 flex-col bg-background'
              style={timeWarp.rebuilding ? { opacity: 0 } : undefined}
            >
              <HybridRowsContext value={rows}>
                <FadeDurationContext value={fadeDuration}>
                  <TenseChangeContext value={tenseChange}>
                    <ChatFeelContext value='hybrid'>
                      <BatchLabelContext value={batchLabel}>
                        <BatchTenseContext value={batchTense}>
                          <WorkLiftContext value={lift}>
                            <HybridPacingContext value={hybridPacing}>
                              <HybridFoldContext value={hybridFold}>
                                <ChatSettledContext value={settled}>
                                  {engine === 'v2' ? (
                                    <HybridV2Pane
                                      thread={thread}
                                      threadId={`replay-${run}-v2`}
                                      projectPath={replay.projectPath}
                                      now={replayStart.current + elapsed}
                                    />
                                  ) : (
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
                                  )}
                                </ChatSettledContext>
                              </HybridFoldContext>
                            </HybridPacingContext>
                          </WorkLiftContext>
                        </BatchTenseContext>
                      </BatchLabelContext>
                    </ChatFeelContext>
                  </TenseChangeContext>
                </FadeDurationContext>
              </HybridRowsContext>
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
        <Link
          to='/dev/stream-states'
          className='text-xs text-muted-foreground hover:text-foreground'
        >
          Stream states
        </Link>
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
          <span className='text-xs text-muted-foreground'>Engine:</span>
          <SettingsSegmented
            label='Engine'
            value={engine}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'v2', label: 'v2' },
            ]}
            onChange={onEngine}
          />
        </div>
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
        <div className='flex items-center gap-1' hidden={engine === 'v2'}>
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
        <div className='flex items-center gap-1' hidden={engine === 'v2'}>
          <span className='text-xs text-muted-foreground'>Batch label:</span>
          <SettingsSegmented
            label='Batch label'
            value={batchLabel}
            options={[
              { value: 'each', label: 'Each' },
              { value: 'hold', label: 'Hold' },
              { value: 'count', label: 'Count' },
            ]}
            onChange={onBatchLabel}
          />
        </div>
        <div className='flex items-center gap-1' hidden={engine === 'v2'}>
          <span className='text-xs text-muted-foreground'>Lift:</span>
          <SettingsSegmented
            label='Lift'
            value={lift}
            options={[
              { value: 'off', label: 'Off' },
              { value: '4px', label: '4px' },
            ]}
            onChange={onLift}
          />
        </div>
        <div className='flex items-center gap-1' hidden={engine === 'v2'}>
          <span className='text-xs text-muted-foreground'>Rows:</span>
          <SettingsSegmented
            label='Rows'
            value={rows}
            options={[
              { value: 'animate', label: 'Animate' },
              { value: 'instant', label: 'Instant' },
            ]}
            onChange={onRows}
          />
        </div>
        <div className='flex items-center gap-1' hidden={engine === 'v2'}>
          <span className='text-xs text-muted-foreground'>Tense change:</span>
          <SettingsSegmented
            label='Tense change'
            value={tenseChange}
            options={[
              { value: 'roll', label: 'Roll' },
              { value: 'crossfade', label: 'Crossfade' },
              { value: 'opencode', label: 'Opencode' },
            ]}
            onChange={onTenseChange}
          />
        </div>
        <div className='flex items-center gap-1'>
          <span className='text-xs text-muted-foreground'>Fade:</span>
          <SettingsSegmented
            label='Fade'
            value={fadeDuration}
            options={[
              { value: '150', label: '150' },
              { value: '300', label: '300' },
            ]}
            onChange={onFadeDuration}
          />
        </div>
        <div className='flex items-center gap-1' hidden={engine === 'v2'}>
          <span className='text-xs text-muted-foreground'>Fold:</span>
          <SettingsSegmented
            label='Fold'
            value={hybridFold}
            options={[
              { value: 'overlap', label: 'Overlap' },
              { value: 'after-reveal', label: 'After reveal' },
              { value: 'first', label: 'Fold first' },
            ]}
            onChange={onHybridFold}
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
