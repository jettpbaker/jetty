import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCallback, useId, useState } from 'react'

import { ActivityContent } from './activity_content'
import { formatActivityDuration, workEnded, type ThinkingActivity } from './work_model'

export function ThinkingBlock({ activity }: { activity: ThinkingActivity }) {
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
  const active = activity.status === 'running'
  const tokens =
    activity.tokens === undefined
      ? undefined
      : `${activity.tokens.toLocaleString('en')} token${activity.tokens === 1 ? '' : 's'}`
  const duration = formatActivityDuration(activity.elapsedSeconds)
  const state = active
    ? 'Thinking'
    : activity.status === 'complete'
      ? 'Thought'
      : activity.status === 'waiting'
        ? 'Thinking paused'
        : activity.status === 'interrupted'
          ? 'Thinking stopped'
          : `Thinking ${activity.status}`
  const amount = tokens ?? (ended ? duration : undefined)
  const titleSuffix = amount ? ` for ${amount}` : ''
  const summary = activity.summary.trim()
  const heading = (
    <span>
      <span className={cn(active && 'shimmer')}>{state}</span>
      {titleSuffix}
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
