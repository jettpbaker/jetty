import type { ContextUsage } from '@jetty/shared/events'

import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pressProps } from '@/lib/press'
import { useStartContainerDev } from '@/state/containers'
import { BoxArrowUpIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import { PageSidebarTrigger } from './page_sidebar_trigger'

const radius = 90
const circumference = 2 * Math.PI * radius

export function ThreadHeader({
  context,
  onUnarchive,
  containerThreadId,
}: {
  context: ContextUsage | null
  // set while the thread is archived
  onUnarchive?: () => void
  containerThreadId?: string
}) {
  const startDev = useStartContainerDev()
  const [services, setServices] = useState<{ name: string; port: number; url?: string }[]>([])
  const [devStatus, setDevStatus] = useState('')
  const fraction = context ? Math.max(0, Math.min(1, context.usedTokens / context.maxTokens)) : 0
  const label = context
    ? `Context window ${Math.round(fraction * 100)}% full`
    : 'Context usage unavailable'
  return (
    <header className='thread-conversation-header flex h-(--app-tab-bar-height) shrink-0 items-center justify-between border-b border-border pr-[42px] pl-(--page-header-inset)'>
      <div className='flex min-w-0 items-center gap-2'>
        <PageSidebarTrigger />
        {onUnarchive && (
          <Button variant='ghost-text' size='sm' {...pressProps(onUnarchive)}>
            <BoxArrowUpIcon />
            Unarchive
          </Button>
        )}
      </div>
      <div className='flex items-center gap-1'>
        {containerThreadId && (
          <>
            <Button
              variant='ghost-text'
              size='sm'
              disabled={devStatus === 'Starting…'}
              {...pressProps(() => {
                setDevStatus('Starting…')
                startDev(
                  containerThreadId,
                  (reply) => {
                    setServices([...reply.services])
                    setDevStatus('')
                  },
                  () => setDevStatus('Failed')
                )
              })}
            >
              Start dev servers
            </Button>
            {services.map((service) =>
              service.url ? (
                <a
                  key={service.name}
                  className={buttonVariants({ variant: 'ghost-text', size: 'sm' })}
                  href={service.url}
                  target='_blank'
                  rel='noreferrer'
                >
                  Open {service.name} · {service.port}
                </a>
              ) : (
                <span key={service.name} className='text-xs text-muted-foreground'>
                  Forward port {service.port}
                </span>
              )
            )}
            {devStatus && <output className='text-xs text-muted-foreground'>{devStatus}</output>}
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            render={<Button variant='ghost' tone='muted' size='icon' aria-label={label} />}
          >
            <svg
              viewBox='0 0 256 256'
              aria-hidden='true'
              className={fraction >= 0.9 ? 'text-destructive' : undefined}
            >
              <circle
                cx='128'
                cy='128'
                r={radius}
                fill='none'
                strokeWidth='26'
                className='stroke-border'
              />
              {context && (
                <circle
                  cx='128'
                  cy='128'
                  r={radius}
                  fill='none'
                  strokeWidth='26'
                  stroke='currentColor'
                  strokeLinecap='round'
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - fraction)}
                  transform='rotate(-90 128 128)'
                />
              )}
            </svg>
          </TooltipTrigger>
          <TooltipContent>
            {context
              ? `${context.usedTokens.toLocaleString()} / ${context.maxTokens.toLocaleString()} context tokens`
              : 'No context reading yet'}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
