import type { ImageAttachments } from '@/hooks/use-image-attachments'
import type { PermissionMode, ProviderModel } from '@jetty/shared/wire'

import { ComposerAccessMode } from '@/components/custom/composer_access_mode'
import { ComposerAttach, ComposerImages } from '@/components/custom/composer_attach'
import { ComposerEnvironment } from '@/components/custom/composer_environment'
import { ComposerShadow } from '@/components/custom/composer_shadow'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { initialComposerShadowSettings } from '@/lib/composer-shadow-settings'
import { cn } from '@/lib/utils'
import { StopIcon } from '@phosphor-icons/react'
import { ArrowUpIcon } from '@primer/octicons-react'
import { useEffect, useEffectEvent, useRef, type CSSProperties, type ReactNode } from 'react'

export function Composer({
  value,
  onValueChange,
  onSubmit,
  onInterrupt,
  running,
  strip,
  placeholder = 'What would you like to work on?',
  sendLabel = 'Send',
  sendDisabled,
  sendHint,
  onKeyDown,
  loadout,
  model,
  accessMode,
  onAccessModeChange,
  attachments,
  context,
  rows = 2,
  ambient = false,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onInterrupt: () => void
  running: boolean
  strip?: ReactNode
  placeholder?: string
  sendLabel?: string
  // defaults to disabled while empty
  sendDisabled?: boolean
  sendHint?: string
  onKeyDown?: (event: KeyboardEvent) => void
  loadout: ReactNode
  model?: ProviderModel
  accessMode: PermissionMode
  onAccessModeChange: (accessMode: PermissionMode) => void
  attachments: ImageAttachments
  context: ReactNode
  rows?: number
  ambient?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const empty = !value.trim() && attachments.images.length === 0
  const canSend = !(sendDisabled ?? empty) && attachments.ready
  const stop = running && empty

  const append = useEffectEvent((key: string) => onValueChange(value + key))
  const handleKey = useEffectEvent((event: KeyboardEvent) => onKeyDown?.(event))

  // A native listener, unlike React's, doesn't hear keys from portaled menus.
  useEffect(() => {
    const element = root.current
    if (!element) return
    function listener(event: KeyboardEvent) {
      handleKey(event)
    }
    element.addEventListener('keydown', listener)
    return () => element.removeEventListener('keydown', listener)
  }, [])

  useEffect(() => {
    function focusComposer(event: KeyboardEvent) {
      if (
        event.code === 'Space' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.length !== 1
      )
        return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            'input, textarea, select, button, a, [role="button"], [role="checkbox"], [role="combobox"], [role="textbox"], [role="slider"], [role="separator"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="dialog"]'
          ))
      )
        return
      if (window.getSelection()?.toString()) return
      const input = textarea.current
      if (!input) return
      event.preventDefault()
      append(event.key)
      input.focus({ preventScroll: true })
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length))
    }
    document.addEventListener('keydown', focusComposer)
    return () => document.removeEventListener('keydown', focusComposer)
  }, [])

  function submit() {
    if (canSend) onSubmit()
  }

  return (
    <div ref={root} className='mx-auto flex w-full max-w-[660px] flex-col gap-1'>
      <div>
        {strip ? <div className='px-3'>{strip}</div> : null}
        <div
          className='relative'
          style={
            ambient ? ({ '--composer-radius': 'var(--radius-md)' } as CSSProperties) : undefined
          }
        >
          {ambient && <ComposerShadow settings={initialComposerShadowSettings} />}
          <InputGroup
            className={cn(
              'relative w-full max-w-[660px] border-0 bg-popover dark:bg-popover has-[[data-slot=input-group-control]:focus-visible]:ring-0',
              ambient && 'shadow-none'
            )}
          >
            <ComposerImages images={attachments.images} onRemove={attachments.remove} />
            <InputGroupTextarea
              ref={textarea}
              aria-label='Thread prompt'
              placeholder={placeholder}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              onPaste={(event) => {
                if (event.clipboardData.files.length === 0) return
                event.preventDefault()
                attachments.add(event.clipboardData.files)
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  submit()
                }
              }}
              rows={rows}
              style={{ minHeight: `calc(${rows}lh + 1rem)` }}
              className='scroll-fade-y scrollbar-subtle max-h-60 min-h-0'
            />
            <InputGroupAddon align='block-end' className='justify-between'>
              <div className='flex items-center gap-0'>
                <ComposerAttach onAttach={attachments.add} />
                {loadout}
                <ComposerAccessMode
                  value={accessMode}
                  model={model}
                  onChange={onAccessModeChange}
                />
              </div>
              <div className='flex items-center gap-1'>
                <ComposerEnvironment />
                {stop ? (
                  <InputGroupButton
                    variant='default'
                    size='icon-sm'
                    aria-label='Stop'
                    onClick={onInterrupt}
                  >
                    <StopIcon weight='fill' />
                  </InputGroupButton>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className={canSend ? 'flex' : 'flex cursor-not-allowed'} />}
                    >
                      <InputGroupButton
                        variant='default'
                        size='icon-sm'
                        aria-label={sendLabel}
                        onClick={submit}
                        disabled={!canSend}
                        className={canSend ? undefined : 'pointer-events-none'}
                      >
                        <ArrowUpIcon />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>{sendHint ?? sendLabel}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>
      {attachments.error ? (
        <p className='px-2.5 text-xs text-destructive'>{attachments.error}</p>
      ) : null}
      {context}
    </div>
  )
}
