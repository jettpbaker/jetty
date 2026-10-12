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
            variant='ghost-text'
            className='activity-header'
            data-flush={flushHeader || undefined}
            aria-expanded={expanded}
            aria-controls={id}
            onClick={toggle}
          >
            {heading}
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
