import type { ProjectIcon } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { useBot } from '@/state'
import { useEffect, useRef } from 'react'

import { JettyBot } from './jetty_bot'
import { HeldKeybind, type Keybind } from './keybinds'
import { ProjectGlyph } from './project_glyph'
import { ThreadHoverCard } from './thread_hover'
import { ThreadRowActions, type ThreadRowActionsProps } from './thread_row_actions'
import { StatusGlyph, type ThreadStatus } from './thread_status'
import './thread_row.css'

export function ThreadRow({
  id,
  botId,
  title,
  project,
  projectIcon,
  status,
  detail,
  lastActivity,
  shortcut,
  selected,
  nested = false,
  showProject = true,
  actions,
  onSelect,
}: {
  id: string
  botId?: string
  title: string
  project: string
  projectIcon?: ProjectIcon
  status: ThreadStatus
  detail?: string
  lastActivity: string
  shortcut?: Keybind
  selected: boolean
  nested?: boolean
  showProject?: boolean
  actions: Omit<ThreadRowActionsProps, 'title'>
  onSelect: () => void
}) {
  const bot = useBot(botId)
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <div ref={rowRef} className='thread-row keybind-target' data-selected={selected || undefined}>
      <ThreadHoverCard threadId={id}>
        {(trigger) => (
          <Button
            render={trigger}
            variant='ghost-text'
            className='thread-row-button h-auto min-h-7.5 w-full min-w-0 justify-start gap-1 rounded-sm px-2.5 py-0.75 text-left font-normal text-foreground'
            aria-pressed={selected}
            onClick={onSelect}
          >
            <HeldKeybind binding={shortcut}>
              <StatusGlyph status={status} className='size-3.5' />
            </HeldKeybind>
            {!nested && (showProject || (bot && !bot.archived)) && (
              <span className='flex size-3.5 shrink-0 items-center justify-center' title={project}>
                {bot && !bot.archived ? (
                  <JettyBot shape={bot.shape} color={bot.color} size={14} />
                ) : (
                  <ProjectGlyph icon={projectIcon} className='size-3' />
                )}
              </span>
            )}
            <span className='flex min-w-0 flex-1 flex-col'>
              <span data-thread-title className='truncate leading-5'>
                {title}
              </span>
              {detail && (
                <span className='truncate text-xs leading-4 text-muted-foreground'>{detail}</span>
              )}
            </span>
            <span
              className='thread-row-age w-7 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums'
              aria-label={
                lastActivity === 'now'
                  ? 'Last activity just now'
                  : `Last activity ${lastActivity} ago`
              }
            >
              {lastActivity}
            </span>
          </Button>
        )}
      </ThreadHoverCard>
      <ThreadRowActions title={title} {...actions} />
    </div>
  )
}
