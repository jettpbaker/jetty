import { Button } from '@/components/ui/button'
import { useChatFeel, useTenseChange } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { ActivityContent } from './activity_content'
import { TenseText } from './tense_text'
import { formatActivityDuration, workEnded, type ThinkingActivity } from './work_model'

const TICK_MS = 120

// v1's climb: every tick closes a tenth of the gap to the latest total, at least one token. It
// writes the node directly, so a climbing count never re-renders the work block. A settled count
// shows its true total at once.
function TokenCount({ value, from, settled }: { value: number; from: number; settled: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [initial] = useState(from)
  const shown = useRef(initial)
  const lastTick = useRef(0)
  useEffect(() => {
    const node = ref.current!
    function show(count: number) {
      shown.current = count
      node.textContent = count.toLocaleString('en')
    }
    if (
      settled ||
      shown.current >= value ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      show(value)
      return
    }
    let frame = requestAnimationFrame(function tick(now) {
      if (now - lastTick.current >= TICK_MS) {
        lastTick.current = now
        show(shown.current + Math.max(1, Math.round((value - shown.current) / 10)))
      }
      if (shown.current < value) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [value, settled])
  return (
    <span ref={ref} className='font-mono'>
      {initial.toLocaleString('en')}
    </span>
  )
}

export function ThinkingBlock({ activity }: { activity: ThinkingActivity }) {
  // A count already known at mount (a revisit) starts there; one that arrives later climbs from 0.
  const [mountTokens] = useState(activity.tokens)
  const ended = workEnded(activity.status)
  const [previousEnded, setPreviousEnded] = useState(ended)
  const contentId = useId()
  const [expanded, setExpanded] = useState(false)
  const [fullText, setFullText] = useState(false)
  if (!ended && fullText !== expanded) setFullText(expanded)
  if (previousEnded !== ended) {
    setPreviousEnded(ended)
    setExpanded(false)
  }
  const [overflowing, setOverflowing] = useState(false)
  const measure = useCallback((node: HTMLParagraphElement | null) => {
    if (!node) return
    const update = () =>
      setOverflowing(
        node.getBoundingClientRect().height >
          parseFloat(getComputedStyle(document.documentElement).fontSize) * 4.5
      )
    const observer = new ResizeObserver(update)
    observer.observe(node)
    update()
    return () => observer.disconnect()
  }, [])
  const feel = useChatFeel()
  const tenseChange = useTenseChange()
  const active = activity.status === 'running'
  const tokens = activity.tokens !== undefined && (
    <>
      <TokenCount value={activity.tokens} from={mountTokens ?? 0} settled={ended} />
      {` token${activity.tokens === 1 ? '' : 's'}`}
    </>
  )
  // Under a second, or with no timing from the provider, a bare "Thought" beats "for 0s".
  const duration =
    ended && (activity.elapsedSeconds ?? 0) >= 1 && formatActivityDuration(activity.elapsedSeconds)
  const state = active
    ? 'Thinking'
    : activity.status === 'complete'
      ? 'Thought'
      : activity.status === 'waiting'
        ? 'Thinking paused'
        : activity.status === 'interrupted'
          ? 'Thinking stopped'
          : `Thinking ${activity.status}`
  const amount = tokens || duration
  const summary = activity.summary.trim()
  const heading =
    feel === 'hybrid' && tenseChange !== undefined ? (
      <span className='flex min-w-0 items-baseline'>
        <TenseText active={active} morph={tenseChange === 'torph'} shimmer>
          {state}
        </TenseText>
        <TenseText active={active} morph={tenseChange === 'torph'}>
          {amount ? '\u00a0for\u00a0' : ''}
        </TenseText>
        <TenseText
          active={active}
          morph={tenseChange === 'torph'}
          mono
          activeContent={
            activity.tokens !== undefined ? (
              <TokenCount value={activity.tokens} from={mountTokens ?? 0} settled={ended} />
            ) : undefined
          }
        >
          {activity.tokens !== undefined ? activity.tokens.toLocaleString('en') : duration || ''}
        </TenseText>
        <TenseText active={active} morph={tenseChange === 'torph'}>
          {activity.tokens !== undefined ? `\u00a0token${activity.tokens === 1 ? '' : 's'}` : ''}
        </TenseText>
      </span>
    ) : (
      <span>
        <span className={cn(active && 'shimmer')}>{state}</span>
        {amount && <> for {amount}</>}
      </span>
    )
  return (
    <div className='min-w-0'>
      {summary && (ended || overflowing) ? (
        <Button
          variant='ghost-text'
          className='activity-header'
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => {
            if (ended && !expanded) setFullText(true)
            setExpanded((value) => !value)
          }}
        >
          {heading}
        </Button>
      ) : (
        <div className='activity-header text-muted-foreground'>{heading}</div>
      )}
      {summary && (
        <ActivityContent id={contentId} open={!ended || expanded}>
          <div className={!fullText && overflowing ? 'thinking-tail' : undefined}>
            <p ref={measure} className='thinking-text'>
              {summary}
            </p>
          </div>
        </ActivityContent>
      )}
    </div>
  )
}
