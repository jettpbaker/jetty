import type { Loadout } from '@/state'
import type { ProviderId } from '@jetty/shared/wire'

import { ComposerLoadout } from '@/components/custom/composer_loadout'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { StopIcon } from '@phosphor-icons/react'
import { ArrowUpIcon } from '@primer/octicons-react'
import { useEffect, useEffectEvent, useRef } from 'react'

export function Composer({
  value,
  onValueChange,
  onSubmit,
  onInterrupt,
  running,
  sendDisabled = false,
  loadout,
  onLoadoutChange,
  provider,
  providerDisabled,
  rows = 2,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onInterrupt: () => void
  running: boolean
  sendDisabled?: boolean
  loadout: Loadout
  onLoadoutChange: (loadout: Loadout) => void
  provider: ProviderId
  providerDisabled: boolean
  rows?: number
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const canSend = !sendDisabled && value.trim().length > 0
  const stop = running && !value.trim()

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
    <div className='mx-auto flex w-full max-w-[660px] flex-col'>
      <div className='rounded-md bg-popover'>
        <Textarea
          ref={textarea}
          aria-label='Thread prompt'
          placeholder='What would you like to work on?'
          value={value}
          rows={rows}
          style={{ minHeight: `calc(${rows}lh + 1rem)` }}
          className='scroll-fade-y scrollbar-subtle max-h-60 min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent'
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className='flex items-center justify-between px-2.5 pb-2'>
          <ComposerLoadout
            loadout={loadout}
            onChange={onLoadoutChange}
            provider={provider}
            providerDisabled={providerDisabled}
          />
          {stop ? (
            <Button variant='default' size='icon-sm' aria-label='Stop' onClick={onInterrupt}>
              <StopIcon weight='fill' />
            </Button>
          ) : (
            <Button
              variant='default'
              size='icon-sm'
              aria-label='Send'
              disabled={!canSend}
              onClick={submit}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
