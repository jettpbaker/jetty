import type { ImageAttachments } from '@/hooks/use-image-attachments'
import type { PermissionMode } from '@jetty/shared/wire'

import { ComposerAccessMode } from '@/components/custom/composer_access_mode'
import { ComposerAttach, ComposerImages } from '@/components/custom/composer_attach'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { StopIcon } from '@phosphor-icons/react'
import { ArrowUpIcon } from '@primer/octicons-react'
import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react'

export function Composer({
  value,
  onValueChange,
  onSubmit,
  onInterrupt,
  running,
  sendDisabled = false,
  sendHint,
  loadout,
  accessMode,
  onAccessModeChange,
  attachments,
  rows = 2,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onInterrupt: () => void
  running: boolean
  sendDisabled?: boolean
  sendHint?: string
  loadout: ReactNode
  accessMode: PermissionMode
  onAccessModeChange: (accessMode: PermissionMode) => void
  attachments: ImageAttachments
  rows?: number
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const empty = !value.trim() && attachments.images.length === 0
  const canSend = !sendDisabled && !empty && attachments.ready
  const stop = running && empty

  const append = useEffectEvent((key: string) => onValueChange(value + key))

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
            'input, textarea, select, button, a, [role="button"], [role="checkbox"], [role="combobox"], [role="textbox"], [role="slider"], [role="separator"], [role="menu"], [role="menuitem"], [role="menuitemradio"]'
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
    <div
      className='mx-auto flex w-full max-w-[660px] flex-col'
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return
        event.preventDefault()
        attachments.add(event.dataTransfer.files)
      }}
    >
      <div className='rounded-md bg-popover'>
        <ComposerImages images={attachments.images} onRemove={attachments.remove} />
        <Textarea
          ref={textarea}
          aria-label='Thread prompt'
          placeholder='What would you like to work on?'
          value={value}
          rows={rows}
          style={{ minHeight: `calc(${rows}lh + 1rem)` }}
          className='scroll-fade-y scrollbar-subtle max-h-60 min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent'
          onChange={(event) => onValueChange(event.target.value)}
          onPaste={(event) => {
            if (event.clipboardData.files.length === 0) return
            event.preventDefault()
            attachments.add(event.clipboardData.files)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className='flex items-center justify-between px-2.5 pb-2'>
          <div className='flex items-center gap-1.5'>
            <ComposerAttach onAttach={attachments.add} />
            {loadout}
            <ComposerAccessMode value={accessMode} onChange={onAccessModeChange} />
          </div>
          {stop ? (
            <Button variant='default' size='icon-sm' aria-label='Stop' onClick={onInterrupt}>
              <StopIcon weight='fill' />
            </Button>
          ) : (
            <Tooltip disabled={!sendHint}>
              <TooltipTrigger render={<span className='flex' />}>
                <Button
                  variant='default'
                  size='icon-sm'
                  aria-label='Send'
                  disabled={!canSend}
                  className={sendHint ? 'pointer-events-none' : undefined}
                  onClick={submit}
                >
                  <ArrowUpIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sendHint}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      {attachments.error ? (
        <p className='px-2.5 pt-1.5 text-xs text-destructive'>{attachments.error}</p>
      ) : null}
    </div>
  )
}
