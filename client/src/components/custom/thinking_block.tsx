import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCallback, useId, useState } from 'react'

import type { ThinkingActivity } from './work_model'

import { ActivityContent } from './activity_content'

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  if (value < 60) return `${value}s`
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`
}

export function ThinkingBlock({ activity }: { activity: ThinkingActivity }) {
  const active = activity.status === 'running'
  const ended = !active
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
  const length =
    activity.tokens !== undefined
      ? `${activity.tokens.toLocaleString('en')} tokens`
      : activity.elapsedSeconds !== undefined
        ? formatDuration(activity.elapsedSeconds)
        : undefined
  const titleSuffix = length ? ` for ${length}` : active ? '…' : ''
  const summary = activity.summary.trim()
  const heading = (
    <span>
      <span className={cn(active && 'shimmer')}>{active ? 'Thinking' : 'Thought'}</span>
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
