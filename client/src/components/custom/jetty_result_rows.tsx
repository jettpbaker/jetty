import type { SessionStatus } from '@jetty/shared/events'
import type { ProviderModel } from '@jetty/shared/wire'

import { Button, buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { cloneElement, useState, type ReactElement, type ReactNode } from 'react'

import { ActivityChevron } from './activity_disclosure'
import { ModelLabel } from './model_label'
import { ProviderGlyph } from './provider_glyph'
import { RollingNumber } from './rolling_number'
import { StatusGlyph, threadStatus, type Status } from './thread_status'

export type ModelResult = Pick<
  ProviderModel,
  'provider' | 'id' | 'name' | 'efforts' | 'defaultEffort'
>
export type ThreadResult = {
  id: string
  title: string
  project?: string
  status?: SessionStatus
  readyForReview?: boolean
  archived?: boolean
}

export function Disclosure({
  title,
  label,
  autoOpen = false,
  flush,
  children,
}: {
  title: ReactNode
  label?: string
  autoOpen?: boolean
  // Lines its title up with the text around it instead of the work history's inset.
  flush?: boolean
  children: ReactNode
}) {
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
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='activity-header'
        data-flush={flush || undefined}
        aria-label={label}
      >
        <span>{title}</span>
        <ActivityChevron />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(autoClosing && 'work-batch-auto-close')}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function CappedResults({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      className='max-h-35 overflow-y-auto overscroll-contain'
      aria-label={label}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need focus to scroll the remaining rows
      tabIndex={0}
    >
      {children}
    </section>
  )
}

export function ModelRow({ result }: { result: ModelResult }) {
  const model: ProviderModel = { ...result, fast: false, autoMode: false }
  return (
    <Disclosure
      title={
        <span className='inline-flex items-center gap-1.5 text-foreground'>
          <ProviderGlyph provider={model.provider} className='size-3 text-muted-foreground' />
          <ModelLabel model={model} />
        </span>
      }
    >
      <div className='flex flex-col gap-1 py-1 pl-2 text-xs text-muted-foreground'>
        <p className='font-mono'>{model.id}</p>
        <p>Effort: {model.efforts.join(' · ')}</p>
        {model.defaultEffort && <p>Default: {model.defaultEffort}</p>}
      </div>
    </Disclosure>
  )
}

export function ThreadRow({
  result,
  onSelect,
  status,
  glyph,
  render,
  placeholder = false,
}: {
  result: ThreadResult
  onSelect?: (result: ThreadResult) => void
  status?: Status
  // Stands in for the status glyph, for a row that isn't a thread.
  glyph?: ReactNode
  placeholder?: boolean
  render?: ReactElement<{
    className?: string
    title?: string
    children?: ReactNode
    'data-slot'?: string
  }>
}) {
  const className = 'min-w-0 shrink justify-start gap-1.5 px-0 text-13 font-normal'
  const title = result.title
  const children = (
    <>
      {glyph}
      {!glyph && (status || result.archived || result.status) && (
        <StatusGlyph
          status={
            status ??
            (result.archived ? 'archived' : threadStatus(result.status!, result.readyForReview))
          }
          className='size-3.25'
        />
      )}
      <span className='truncate'>{result.title}</span>
    </>
  )
  return (
    <div className='activity-header activity-file-row'>
      {placeholder ? (
        <span className={cn('inline-flex items-center text-muted-foreground', className)}>
          {children}
        </span>
      ) : render ? (
        cloneElement(render, {
          className: cn(buttonVariants({ variant: 'link', size: 'sm' }), className),
          title,
          children,
          'data-slot': 'button',
        })
      ) : (
        <Button
          variant='link'
          size='sm'
          className={className}
          title={title}
          onClick={onSelect ? () => onSelect(result) : undefined}
        >
          {children}
        </Button>
      )}
    </div>
  )
}

export function CountedResults({
  verb,
  count,
  noun,
  active = false,
  autoOpen = false,
  details,
  notice,
  noticeText,
  children,
}: {
  verb: string
  count?: number
  noun: string
  active?: boolean
  autoOpen?: boolean
  details?: ReactNode
  notice?: ReactNode
  noticeText?: string
  children: ReactNode
}) {
  const label = `${verb} ${count === undefined ? '' : `${count} `}${noun}${count === 1 ? '' : 's'}${noticeText ? `, ${noticeText}` : ''}`
  return (
    <Disclosure
      label={label}
      autoOpen={autoOpen}
      title={
        <span className='inline-flex items-baseline gap-1'>
          <span className={cn(active && 'shimmer')}>{verb}</span>
          {count !== undefined && <RollingNumber value={count} className='font-mono' />}
          <span>
            {noun}
            {count === 1 ? '' : 's'}
          </span>
          {notice}
        </span>
      }
    >
      <div className='pl-2'>
        <CappedResults label={label}>{children}</CappedResults>
        {details}
      </div>
    </Disclosure>
  )
}

export function EntityDetails({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Disclosure title={title}>
      <div className='py-1 pl-2 text-xs leading-relaxed text-muted-foreground'>{children}</div>
    </Disclosure>
  )
}
