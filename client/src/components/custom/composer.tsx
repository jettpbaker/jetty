import type { ImageAttachments } from '@/hooks/use-image-attachments'
import type { PermissionMode, ProviderModel } from '@jetty/shared/wire'

import { ComposerAccessMode } from '@/components/custom/composer_access_mode'
import { ComposerAttach, ComposerImages } from '@/components/custom/composer_attach'
import { ComposerShadow, useWallpaperUnderComposer } from '@/components/custom/composer_shadow'
import {
  SlashMenu,
  SlashMirror,
  useComposerSlash,
  type SlashScope,
} from '@/components/custom/composer_slash'
import { StopIcon, ArrowUp02Icon, PlayIcon } from '@/components/custom/huge_icons'
import { keyTarget } from '@/components/custom/keybinds'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { initialComposerShadowSettings } from '@/lib/composer-shadow-settings'
import { inComposition } from '@/lib/composition'
import { cn } from '@/lib/utils'
import { perf } from '@/perf'
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'

export function Composer({
  value,
  onValueChange,
  onSubmit,
  onBackgroundSubmit,
  onInterrupt,
  onContinue,
  onChooseModel,
  running,
  stop,
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
  header,
  context,
  rows = 2,
  ambient = false,
  inputRef,
  slash,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  // ⌘Enter / Ctrl+Enter; without it the chord is left to onKeyDown
  onBackgroundSubmit?: () => void
  onInterrupt: () => void
  // Offered in place of Send while the composer is empty: carries on a paused thread.
  onContinue?: () => void
  // A new thread with nothing to send as: Enter and Send open the model menu.
  onChooseModel?: () => void
  running: boolean
  // Stop in place of Send even when a request is showing, as while an approval waits on an empty draft.
  stop?: boolean
  strip?: ReactNode
  placeholder?: string
  sendLabel?: string
  // defaults to disabled while empty
  sendDisabled?: boolean
  sendHint?: ReactNode
  onKeyDown?: (event: KeyboardEvent) => void
  loadout: ReactNode
  model?: ProviderModel
  accessMode: PermissionMode
  onAccessModeChange: (accessMode: PermissionMode) => void
  attachments: ImageAttachments
  header?: ReactNode
  context: ReactNode
  rows?: number
  ambient?: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
  // Where the / menu's skills and model come from.
  slash?: SlashScope
}) {
  const root = useRef<HTMLDivElement>(null)
  const wallpaperUnder = useWallpaperUnderComposer()
  const ownInput = useRef<HTMLTextAreaElement>(null)
  const textarea = inputRef ?? ownInput
  const empty = !value.trim() && attachments.images.length === 0
  const canSend = !(sendDisabled ?? empty) && attachments.ready
  const stopping = stop || (running && empty)
  const play = !stopping && !running && empty && onContinue !== undefined
  const menu = useComposerSlash(value, onValueChange, textarea, slash)
  const { field } = menu

  useLayoutEffect(() => perf.rendered('app.launch'), [])

  const append = useEffectEvent((key: string) => onValueChange(value + key))
  const handleKey = useEffectEvent((event: KeyboardEvent) => onKeyDown?.(event))

  // A native listener, unlike React's, doesn't hear keys from portaled menus.
  useEffect(() => {
    const element = root.current
    if (!element) return
    function listener(event: KeyboardEvent) {
      // Esc and ⌘Enter mid-composition belong to the IME, not to the strip's irreversible actions.
      if (!inComposition(event)) handleKey(event)
    }
    element.addEventListener('keydown', listener)
    return () => element.removeEventListener('keydown', listener)
  }, [])

  useEffect(() => {
    function focusComposer(event: KeyboardEvent) {
      if (
        event.code === 'Space' ||
        event.defaultPrevented ||
        inComposition(event) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.length !== 1
      )
        return
      const target = keyTarget(event)
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
  }, [textarea])

  function submit() {
    if (canSend) onSubmit()
  }

  return (
    <div
      ref={root}
      data-perf-region='composer'
      className='mx-auto flex w-full max-w-[660px] flex-col gap-1'
    >
      {header}
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
              'relative w-full max-w-[660px] border-0 bg-popover dark:bg-popover',
              // Over a wallpaper the ambient shadow does the lifting.
              ambient && (wallpaperUnder ? 'shadow-none' : 'composer-lift')
            )}
          >
            <ComposerImages images={attachments.images} onRemove={attachments.remove} />
            <div
              ref={field}
              data-composing={menu.composing || undefined}
              className='skill-chip-field relative w-full'
            >
              <SlashMirror slash={menu} />
              <InputGroupTextarea
                ref={textarea}
                aria-label='Thread prompt'
                {...menu.input}
                placeholder={placeholder}
                onPaste={(event) => {
                  if (event.clipboardData.files.length === 0) return
                  event.preventDefault()
                  attachments.add(event.clipboardData.files)
                }}
                onKeyDown={(event) => {
                  if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey) return
                  if (inComposition(event.nativeEvent)) return
                  if (onChooseModel) {
                    event.preventDefault()
                    onChooseModel()
                    return
                  }
                  const send = event.metaKey || event.ctrlKey ? onBackgroundSubmit : onSubmit
                  if (!send) return
                  event.preventDefault()
                  if (canSend) send()
                }}
                rows={rows}
                style={{ minHeight: `calc(${rows}lh + 1rem)` }}
                className='skill-chip-text relative scroll-fade-y scrollbar-subtle max-h-60 min-h-0'
              />
              {menu.open && <SlashMenu slash={menu} />}
            </div>
            <InputGroupAddon align='block-end' className='justify-between'>
              <div className='flex items-center gap-0'>
                <ComposerAttach onAttach={attachments.add} disabledReason={attachments.refused} />
                {loadout}
                <ComposerAccessMode
                  value={accessMode}
                  model={model}
                  onChange={onAccessModeChange}
                />
              </div>
              <div className='flex items-center gap-1'>
                {stopping ? (
                  <InputGroupButton
                    variant='default'
                    size='icon-sm'
                    aria-label='Stop'
                    onClick={onInterrupt}
                  >
                    <StopIcon filled />
                  </InputGroupButton>
                ) : play ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <InputGroupButton
                          variant='default'
                          size='icon-sm'
                          aria-label='Resume'
                          onClick={onContinue}
                        />
                      }
                    >
                      <PlayIcon filled />
                    </TooltipTrigger>
                    <TooltipContent>Resume</TooltipContent>
                  </Tooltip>
                ) : onChooseModel ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className='flex' />}>
                      <InputGroupButton
                        variant='default'
                        size='icon-sm'
                        aria-label='Choose a model'
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onChooseModel}
                      >
                        <ArrowUp02Icon />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>{sendHint}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className={canSend ? 'flex' : 'flex cursor-not-allowed'} />}
                    >
                      <InputGroupButton
                        variant='default'
                        size='icon-sm'
                        aria-label={sendLabel}
                        // The caret stays in the composer, so the next message or paste follows at once.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={submit}
                        disabled={!canSend}
                        className={canSend ? undefined : 'pointer-events-none'}
                      >
                        <ArrowUp02Icon />
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
