import { ApprovalDock } from '@/components/approval-dock'
import { ContextGroupRow } from '@/components/context-group'
import { Timeline } from '@/components/timeline'
import { TimelineItem } from '@/components/timeline-item'
import { Button } from '@/components/ui/button'
import { pressHandlers } from '@/lib/press-handlers'
import { cn } from '@/lib/utils'
import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { ArrowCounterClockwiseIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  compileTape,
  CONTEXT_SCENARIOS,
  DOCK_APPROVAL,
  SHEET_GROUPS,
  type TapeStep,
} from './styleguide-chat-tape'

// The dock's respond goes through the socket in the thread route; the lab wires
// a noop so the sheet renders without firing a request.
const noopRespond = () => Promise.resolve()

// The production Timeline replaying a tape of wire events through the real
// reducer, plus per-component spec sheets. No lab-only chat components — the
// rig and the sheets render exactly what the thread route renders.

const SPEEDS = [0.5, 1, 2, 4] as const

type Speed = (typeof SPEEDS)[number]

function useTapeReplay(speed: Speed) {
  const [state, setState] = useState<ThreadState>(emptyThread)
  const [playing, setPlaying] = useState(true)
  const [done, setDone] = useState(false)
  const [runId, setRunId] = useState(0)
  const stepsRef = useRef<TapeStep[] | null>(null)
  const indexRef = useRef(0)
  const seqRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const speedRef = useRef<Speed>(speed)
  speedRef.current = speed

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const replay = useCallback(() => {
    clearTimer()
    stepsRef.current = compileTape()
    indexRef.current = 0
    seqRef.current = 0
    setState(emptyThread)
    setDone(false)
    setPlaying(true)
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
    stepsRef.current ??= compileTape()

    function next() {
      const step = stepsRef.current![indexRef.current]
      if (!step) {
        setDone(true)
        setPlaying(false)
        return
      }
      timerRef.current = window.setTimeout(() => {
        indexRef.current += 1
        seqRef.current += 1
        setState((prev) =>
          applyEvent(prev, { seq: seqRef.current, ts: Date.now(), event: step.event })
        )
        next()
      }, step.delay / speedRef.current)
    }

    next()
    return clearTimer
  }, [playing, done, runId, clearTimer])

  return { state, playing, done, runId, replay, toggle }
}

export function ChatLab() {
  const [speed, setSpeed] = useState<Speed>(1)
  const [contextScenario, setContextScenario] = useState(0)
  const rig = useTapeReplay(speed)
  const selectedContext = CONTEXT_SCENARIOS[contextScenario] ?? CONTEXT_SCENARIOS[0]!

  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-10 p-8'>
      <header className='flex flex-col gap-2'>
        <h1 className='text-2xl font-semibold tracking-tight'>Chat lab</h1>
        <p className='max-w-2xl text-sm text-muted-foreground'>
          The production timeline replaying a tape mined from the session that built this styleguide
          — same reducer, same components as the thread route. Spec sheets below show each item kind
          in isolation.
        </p>
      </header>

      <section className='flex flex-col gap-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='outline' size='sm' {...pressHandlers(rig.toggle)}>
            {rig.done ? (
              <>
                <ArrowCounterClockwiseIcon />
                Replay
              </>
            ) : rig.playing ? (
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
          <Button variant='ghost' size='sm' {...pressHandlers(rig.replay)}>
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
            {rig.state.status}
            {' · '}
            {rig.state.items.length} items
          </span>
        </div>

        <div className='flex h-[560px] flex-col overflow-hidden rounded-lg border'>
          <Timeline
            key={rig.runId}
            threadId='styleguide-rig'
            items={rig.state.items}
            status={rig.state.status}
            activeTurnId={rig.state.activeTurnId}
          />
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <h2 className='text-sm font-medium'>Gathered context</h2>
        <div className='flex flex-wrap items-center gap-2'>
          {CONTEXT_SCENARIOS.map((scenario, index) => (
            <button
              key={scenario.label}
              type='button'
              className={cn(
                'rounded-md px-2 py-1 font-mono text-xs transition-colors',
                contextScenario === index
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              {...pressHandlers(() => setContextScenario(index))}
            >
              {scenario.label}
            </button>
          ))}
        </div>
        <ContextGroupRow items={selectedContext.items} live={selectedContext.live} />
      </section>

      <section className='flex flex-col gap-4'>
        <h2 className='text-sm font-medium'>Approval dock</h2>
        <p className='max-w-2xl text-sm text-muted-foreground'>
          Replaces the composer while a turn awaits approval. Enter allows, Esc denies; the message
          affordance reveals a single-line steer that submits as a deny.
        </p>
        <div className='flex flex-col gap-6'>
          <div className='flex flex-col gap-2'>
            <span className='font-mono text-[10px] tracking-wide text-muted-foreground uppercase'>
              pending
            </span>
            <ApprovalDock item={DOCK_APPROVAL} respond={noopRespond} />
          </div>
          <div className='flex flex-col gap-2'>
            <span className='font-mono text-[10px] tracking-wide text-muted-foreground uppercase'>
              message input open
            </span>
            <ApprovalDock item={DOCK_APPROVAL} respond={noopRespond} defaultMessageOpen />
          </div>
        </div>
      </section>

      {SHEET_GROUPS.map((group) => (
        <section key={group.title} className='flex flex-col gap-4'>
          <h2 className='text-sm font-medium'>{group.title}</h2>
          <div className='flex flex-col gap-6'>
            {group.entries.map((entry) => (
              <div key={entry.label} className='flex flex-col gap-2'>
                <span className='font-mono text-[10px] tracking-wide text-muted-foreground uppercase'>
                  {entry.label}
                </span>
                <TimelineItem item={entry.item} threadId='styleguide-sheet' />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
