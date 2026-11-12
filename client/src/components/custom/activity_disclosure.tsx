import { Button } from '@/components/ui/button'
import { useId, useState, type ReactNode } from 'react'

import { ActivityContent } from './activity_content'
import './work.css'
import { ChevronRightSmallIcon } from './central_icons'

export type ActivityView = 'preview' | 'full'

export function ActivityChevron() {
  return <ChevronRightSmallIcon className='activity-chevron text-muted-foreground' aria-hidden />
}

// Opens and closes with `autoOpen` each time it changes; between changes the reader toggles it.
// `autoClosing` marks a close `autoOpen` made, so the content can animate out.
export function useAutoOpen(autoOpen: boolean) {
  const [previousAutoOpen, setPreviousAutoOpen] = useState(autoOpen)
  const [open, setOpen] = useState(autoOpen)
  const [autoClosing, setAutoClosing] = useState(false)
  if (previousAutoOpen !== autoOpen) {
    setPreviousAutoOpen(autoOpen)
    setAutoClosing(!autoOpen && open)
    setOpen(autoOpen)
  }
  function onOpenChange(nextOpen: boolean) {
    setAutoClosing(false)
    setOpen(nextOpen)
  }
  return { open, onOpenChange, autoClosing }
}

export function ActivityDisclosure({
  title,
  titleSuffix,
  ended = false,
  hasContent = true,
  renderContent,
  flushHeader = false,
  animateHeader = false,
}: {
  title: ReactNode
  titleSuffix?: ReactNode
  ended?: boolean
  hasContent?: boolean
  renderContent: (view: ActivityView) => ReactNode
  flushHeader?: boolean
  animateHeader?: boolean
}) {
  const id = useId()
  const [view, setView] = useState<ActivityView>('preview')
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
    </div>
  )
}
