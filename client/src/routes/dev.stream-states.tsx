import type { ThreadState } from '@jetty/shared/reducer'

import { Refresh01Icon } from '@/components/custom/huge_icons'
import { HybridV2Pane } from '@/components/custom/hybrid_v2'
import { SettingsSegmented } from '@/components/custom/settings_layout'
import { Button } from '@/components/ui/button'
import { landReplayEvent } from '@/dev/replay_event'
import { streamStates, type StreamState } from '@/dev/stream_states'
import { speedOptions, useTimeWarp } from '@/dev/time_warp'
import {
  ChatFeelContext,
  ChatSettledContext,
  FadeDurationContext,
  HybridLineContext,
  HybridPacingContext,
  InterimTextContext,
  LiveTurnContext,
  pinRootChatFeel,
} from '@/lib/chat-feel'
import { emptyThread } from '@jetty/shared/reducer'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'

import './dev.feels.css'

export const Route = createFileRoute('/dev/stream-states')({ component: StreamStates })

const groups = ['Turn', 'Thinking', 'Tools', 'Text', 'Now-line', 'Fold'] as const

function StreamStates() {
  const warp = useTimeWarp()
  const onSpace = useEffectEvent(() => warp.setFrozen(!warp.frozen))
  useEffect(() => pinRootChatFeel(), [])
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key !== ' ' || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select') || target.isContentEditable)
      )
        return
      event.preventDefault()
      onSpace()
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [])
  return (
    <div className='fixed inset-0 z-50 overflow-y-auto bg-background'>
      <div className='mx-auto flex max-w-[1280px] flex-col gap-6 p-6'>
        <div className='flex flex-col gap-3'>
          <Link
            to='/dev/feels'
            className='w-fit text-sm text-muted-foreground hover:text-foreground'
          >
            ← Turn replays
          </Link>
          <h1 className='text-xl font-medium'>Stream states</h1>
          <p className='max-w-2xl text-sm text-muted-foreground'>
            Hybrid v2, one transition at a time. Replay a card once; Space freezes the whole page.
          </p>
          <div className='flex items-center gap-3'>
            <span className='text-xs text-muted-foreground'>Speed</span>
            <SettingsSegmented
              label='Speed'
              value={warp.speed}
              options={speedOptions}
              onChange={warp.setSpeed}
            />
            <output className='text-xs text-muted-foreground'>
              {warp.frozen ? 'Frozen · Space to resume' : 'Space to freeze'}
            </output>
          </div>
        </div>
        {warp.ready && (
          <LiveTurnContext value='single'>
            <ChatFeelContext value='hybrid'>
              <HybridLineContext value='both'>
                <InterimTextContext value='b'>
                  <FadeDurationContext value='300'>
                    <HybridPacingContext value='cursor'>
                      {groups.map((group) => (
                        <section key={group} aria-label={group} className='flex flex-col gap-3'>
                          <h2 className='text-sm font-medium'>{group}</h2>
                          <div className='grid grid-cols-1 gap-px border border-border bg-border md:grid-cols-2 xl:grid-cols-3'>
                            {streamStates
                              .filter((state) => state.group === group)
                              .map((state) => (
                                <StateCard key={state.id} state={state} />
                              ))}
                          </div>
                        </section>
                      ))}
                    </HybridPacingContext>
                  </FadeDurationContext>
                </InterimTextContext>
              </HybridLineContext>
            </ChatFeelContext>
          </LiveTurnContext>
        )}
      </div>
    </div>
  )
}

function StateCard({ state }: { state: StreamState }) {
  const [run, setRun] = useState(0)
  return (
    <article data-state={state.id} className='flex min-w-0 flex-col gap-3 bg-background p-4'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='text-xs font-medium'>{state.title}</h3>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={`Replay ${state.title}`}
          onClick={() => setRun(run + 1)}
        >
          <Refresh01Icon />
        </Button>
      </div>
      <p className='truncate text-xs text-muted-foreground' title={state.description}>
        {state.description}
      </p>
      <CardReplay key={run} state={state} run={run} />
      {state.limitation && <p className='text-xs text-muted-foreground'>{state.limitation}</p>}
    </article>
  )
}

function seed(state: StreamState, start: number): ThreadState {
  let thread = emptyThread
  for (const [index, event] of state.initial.entries())
    thread = landReplayEvent(thread, event, index + 1, start)
  return thread
}

function CardReplay({ state, run }: { state: StreamState; run: number }) {
  const [start] = useState(Date.now)
  const [thread, setThread] = useState(() => seed(state, start))
  const [elapsed, setElapsed] = useState(0)
  const [settled, setSettled] = useState(true)
  const [playing, setPlaying] = useState(run > 0)
  const paneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!run) return
    setSettled(false)
    let next = 0
    let current = seed(state, start)
    const base = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const at = Math.min(state.duration, now - base)
      while (next < state.events.length && state.events[next]!.t <= at) {
        const { t, event } = state.events[next]!
        current = landReplayEvent(current, event, state.initial.length + next + 1, start + t)
        next++
      }
      setThread(current)
      setElapsed(at === state.duration ? at : Math.floor(at / 100) * 100)
      if (at < state.duration) frame = requestAnimationFrame(tick)
      else setPlaying(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [state, run, start])
  useLayoutEffect(() => {
    if (playing) return
    for (const animation of paneRef.current!.getAnimations({ subtree: true })) animation.pause()
  }, [playing, thread])
  return (
    <div
      ref={paneRef}
      data-chat-feel='hybrid'
      data-engine='v2'
      data-hybrid-line='both'
      data-replay={run === 0 ? 'idle' : playing ? 'playing' : 'done'}
      data-elapsed={Math.round(elapsed)}
      data-chat-settled={settled ? '' : undefined}
      className='flex h-[200px] w-[380px] max-w-full flex-col overflow-hidden rounded-sm border'
    >
      <ChatSettledContext value={settled}>
        <HybridV2Pane
          thread={thread}
          threadId={`states-${state.id}-${run}`}
          now={start + elapsed}
        />
      </ChatSettledContext>
    </div>
  )
}
