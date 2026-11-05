import type { Attachments } from '@/hooks/use-attachments'
import type { PermissionMode, ProviderModel } from '@jetty/shared/wire'

import { StopIcon, ArrowUpIcon } from '@/components/custom/central_icons'
import { ComposerAccessMode } from '@/components/custom/composer_access_mode'
import { ComposerAttach, ComposerAttachments } from '@/components/custom/composer_attach'
import { ComposerMenuAnchorContext } from '@/components/custom/composer_menu_anchor'
import { ComposerShadow, useWallpaperUnderComposer } from '@/components/custom/composer_shadow'
import {
  SlashMenu,
  SlashMirror,
  useComposerSlash,
  type SlashScope,
} from '@/components/custom/composer_slash'
import { keyTarget } from '@/components/custom/keybinds'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWidthBreakpoints } from '@/hooks/use-width-breakpoints'
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

const composerBreakpoints = { narrow: 600, stacked: 480 }

export function Composer({
  value,
  onValueChange,
  onSubmit,
  onBackgroundSubmit,
  onInterrupt,
  onChooseModel,
  running,
  stop,
  strip,
  requestId,
  reply,
  inputNotice,
  placeholder = 'Describe a task or ask a question · / for commands',
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
  onTypeToFocus,
  slash,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  // ⌘Enter / Ctrl+Enter; without it the chord is left to onKeyDown
  onBackgroundSubmit?: () => void
  onInterrupt: () => void
  // A new thread with nothing to send as: Enter and Send open the model menu.
  onChooseModel?: () => void
  running: boolean
  // A turn waiting on an approval or question keeps Stop in this slot. An answer or follow-up
  // that can send sits beside it; otherwise Stop takes Send's place, as on an empty running turn.
  stop?: boolean
  strip?: ReactNode
  requestId?: string
  // The quote the message carries, at the top of the field.
  reply?: ReactNode
  inputNotice?: string
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
  attachments: Attachments
  header?: ReactNode
  context: ReactNode
  rows?: number
  ambient?: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
  onTypeToFocus?: (key: string) => boolean
  // Where the / menu's skills and model come from.
  slash?: SlashScope
}) {
  const root = useRef<HTMLDivElement>(null)
  useWidthBreakpoints(root, composerBreakpoints)
  const wallpaperUnder = useWallpaperUnderComposer()
  const ownInput = useRef<HTMLTextAreaElement>(null)
  const textarea = inputRef ?? ownInput
  const empty = !value.trim() && attachments.items.length === 0
  const menu = useComposerSlash(value, onValueChange, textarea, slash)
  const selectingCommand =
    menu.open &&
    menu.query?.trigger === '/' &&
    menu.query.start === 0 &&
    menu.query.end === value.length &&
    attachments.items.length === 0
  const canSend = !(sendDisabled ?? empty) && attachments.ready && !selectingCommand
  const stopping = stop || (running && empty)
  // Deny with note, Submit and a queued follow-up stay reachable while Stop is up.
  const offerSend = !stopping || (Boolean(stop) && canSend)
  const { field } = menu

  useLayoutEffect(() => perf.rendered('app.launch'), [])

  const typeToFocus = useEffectEvent((key: string) => onTypeToFocus?.(key))
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
      if (typeToFocus(event.key)) return
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
    <ComposerMenuAnchorContext value={root}>
      <div
        ref={root}
        data-perf-region='composer'
        className='group/composer mx-auto flex w-full max-w-[825px] flex-col gap-1 [&_button:focus-visible]:ring-ring'
      >
        <div
          className={cn(
            'flex flex-col',
            requestId ? 'gap-2' : strip && 'overflow-hidden rounded-md bg-popover'
          )}
        >
          {strip ? (
            <div
              className={cn(
                'flex flex-col overflow-hidden rounded-md bg-popover',
                requestId && 'ring-1 ring-status-attention/40'
              )}
            >
              {strip}
            </div>
          ) : null}
          <div
            className='relative'
            style={
              ambient ? ({ '--composer-radius': 'var(--radius-md)' } as CSSProperties) : undefined
            }
          >
            {ambient && <ComposerShadow settings={initialComposerShadowSettings} />}
            <InputGroup
              className={cn(
                'relative w-full max-w-[825px] border-border bg-popover focus-within:ring-2 focus-within:ring-ring dark:border-0 dark:bg-popover',
                strip && !requestId && 'rounded-t-none',
                // Over a wallpaper the ambient shadow does the lifting.
                ambient && (wallpaperUnder ? 'shadow-none' : 'composer-lift')
              )}
            >
              {header && (
                <InputGroupAddon
                  align='block-start'
                  className='rounded-t-md border-b border-border bg-muted/40 p-1'
                >
                  {header}
                </InputGroupAddon>
              )}
              {inputNotice && (
                <p className='w-full px-2.5 pt-2 text-xs text-muted-foreground'>{inputNotice}</p>
              )}
              {reply}
              <ComposerAttachments items={attachments.items} onRemove={attachments.remove} />
              <div
                ref={field}
                data-composing={menu.composing || undefined}
                className='skill-chip-field relative w-full'
              >
                <SlashMirror slash={menu} />
                <InputGroupTextarea
                  ref={textarea}
                  aria-label='Thread prompt'
                  spellCheck={false}
                  {...menu.input}
                  onFocus={menu.input.onFocus}
                  placeholder={placeholder}
                  onPaste={attachments.paste}
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
                  className='skill-chip-text relative scroll-fade-y max-h-60 min-h-0'
                />
                {menu.open && <SlashMenu slash={menu} />}
              </div>
              <InputGroupAddon align='block-end' className='items-end justify-between'>
                <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 group-data-narrow/composer:gap-x-1'>
                  <ComposerAttach
                    onAttach={attachments.add}
                    disabledReason={attachments.refused}
                    className='-ml-2'
                  />
                  {loadout}
                  <ComposerAccessMode
                    value={accessMode}
                    model={model}
                    onChange={onAccessModeChange}
                  />
                  {context && (
                    <div className='flex min-w-0 flex-1 group-data-stacked/composer:basis-full'>
                      {context}
                    </div>
                  )}
                </div>
                <div className='flex items-center gap-1'>
                  {stopping && (
                    <InputGroupButton
                      variant='default'
                      size='icon-sm'
                      aria-label='Stop'
                      onClick={onInterrupt}
                    >
                      <StopIcon filled />
                    </InputGroupButton>
                  )}
                  {!offerSend ? null : onChooseModel ? (
                    <Tooltip>
                      <TooltipTrigger render={<span className='flex' />}>
                        <InputGroupButton
                          variant='default'
                          size='icon-sm'
                          aria-label='Choose a model'
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={onChooseModel}
                        >
                          <ArrowUpIcon />
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
      </div>
    </ComposerMenuAnchorContext>
  )
}
