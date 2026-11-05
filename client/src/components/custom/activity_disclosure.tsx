import { Button } from '@/components/ui/button'
import { useId, useState, type ReactNode } from 'react'

import { ActivityContent } from './activity_content'
import './work.css'
import { ChevronRightSmallIcon } from './central_icons'

export type ActivityView = 'preview' | 'full'

export function ActivityChevron() {
  return <ChevronRightSmallIcon className='activity-chevron text-muted-foreground' aria-hidden />
}

export function ActivityDisclosure({
  title,
  titleSuffix,
  summary,
  defaultView = 'preview',
  ended = false,
  hasContent = true,
  footer,
  renderContent,
  flushHeader = false,
  animateHeader = false,
}: {
  title: ReactNode
  titleSuffix?: ReactNode
  summary?: ReactNode
  defaultView?: ActivityView
  ended?: boolean
  hasContent?: boolean
  footer?: ReactNode
  renderContent: (view: ActivityView) => ReactNode
  flushHeader?: boolean
  animateHeader?: boolean
}) {
  const id = useId()
  const [view, setView] = useState<ActivityView>(defaultView)
  const [previousEnded, setPreviousEnded] = useState(ended)
  const [closed, setClosed] = useState(ended)
  if (previousEnded !== ended) {
    setPreviousEnded(ended)
    setClosed(ended)
  }
  const expanded = ended ? !closed : view === 'full'
  function toggle() {
    if (ended) setClosed((value) => !value)
    else setView((value) => (value === 'full' ? 'preview' : 'full'))
  }
  const heading = (
    <span>
      {title}
      {titleSuffix}
    </span>
  )
  return (
    <div className='min-w-0'>
      <div className={animateHeader ? 'work-raise-enter' : undefined}>
        {hasContent ? (
          <Button
            variant={flushHeader ? 'ghost' : 'ghost-text'}
            className='activity-header'
            data-flush={flushHeader || undefined}
            aria-expanded={expanded}
            aria-controls={id}
            onClick={toggle}
          >
            {heading}
            {summary && (
              <span
                className={
                  flushHeader
                    ? 'ml-1 flex items-center gap-2 text-xs text-muted-foreground'
                    : 'ml-auto pl-3 text-xs text-muted-foreground'
                }
              >
                {flushHeader && <span aria-hidden='true'>·</span>}
                {summary}
              </span>
            )}
            <ActivityChevron />
          </Button>
        ) : (
          <div
            className='activity-header text-muted-foreground'
            data-flush={flushHeader || undefined}
          >
            {heading}
          </div>
        )}
      </div>
      <ActivityContent id={id} open={!ended || !closed}>
        {renderContent(ended ? 'full' : view)}
      </ActivityContent>
      {footer}
    </div>
  )
}
