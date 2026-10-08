import type { Bot, PermissionMode, ProviderModel, Skill } from '@jetty/shared/wire'

import {
  AiFileIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BookOpenIcon,
  BrainIcon,
  ChartHistogramIcon,
  FlashIcon,
  GaugeIcon,
  PencilEdit02Icon,
  ShieldCheckIcon,
  ShieldOffIcon,
  Tick02Icon,
} from '@/components/custom/huge_icons'
import { inComposition } from '@/lib/composition'
import { effortLabels, equipModel, findModel, modelKey } from '@/lib/loadout'
import { cn } from '@/lib/utils'
import {
  useAccessMode,
  useBumpDraft,
  useLoadouts,
  useThreadContext,
  useThreadLoadout,
} from '@/state'
import { useProviderCapabilities, useThreadMeta } from '@/state/chrome'
import { useSkills } from '@/state/skills'
import { useCompactThread } from '@/state/turns'
import { catalogModelName, modelLabelText } from '@jetty/shared/model-name'
import { useNavigate } from '@tanstack/react-router'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  type UIEvent,
} from 'react'

import { BotAvatar, botColorStyle } from './bot_avatar'
import { ContextRing } from './context_ring'
import { JettyBot } from './jetty_bot'
import { ProviderGlyph } from './provider_glyph'
import './composer_slash.css'
import {
  activeSlash,
  applyEdit,
  chipLead,
  chipped,
  matchScore,
  mentionTokens,
  slashTokens,
  type MentionBot,
  type SlashQuery,
  type Trigger,
} from './slash_model'

export type SlashScope = {
  threadId?: string
  projectId?: string
  onUsage?: () => void
  // A bot's chat lists only skills: the commands act on a thread.
  bot?: boolean
  // The bots @ can mention. Without any, @ is just a character.
  mentions?: readonly Bot[]
}

type Section = 'Skills'
type ValueCommand = 'model' | 'effort' | 'access'
type Kind = 'section' | 'back' | 'command' | 'skill' | 'option' | 'bot'

type Entry = {
  id: string
  kind: Kind
  name: string
  description: string
  group: string
  icon?: ReactNode
  opens?: boolean
  selected?: boolean
  disabled?: boolean
  score: number
  run: () => void
}

const accessLabels: Record<PermissionMode, string> = { auto: 'Auto', full_access: 'Full access' }
const accessDescriptions: Record<PermissionMode, string> = {
  auto: 'Ask before risky actions',
  full_access: 'Run anything without asking',
}
const commandOrder = ['model', 'effort', 'fast', 'access', 'compact', 'usage', 'new']
const commandLabels: Record<ValueCommand, string> = {
  model: 'Model',
  effort: 'Effort',
  access: 'Access',
}
const groupOrder = ['Commands', 'Skills']

/* State */

export function useComposerSlash(
  text: string,
  onTextChange: (text: string) => void,
  textarea: RefObject<HTMLTextAreaElement | null>,
  { threadId, projectId, onUsage, bot = false, mentions = [] }: SlashScope = {}
) {
  const field = useRef<HTMLDivElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const seen = useRef(text)
  const [caret, setCaret] = useState(text.length)
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  // The slash word being typed, which stays plain text until the caret leaves it.
  const [editing, setEditing] = useState<number>()
  const [dismissed, setDismissed] = useState<number>()
  // The submenu open, on the slash word it was opened from.
  const [level, setLevel] = useState<{
    start: number
    section?: Section
    picking?: ValueCommand
  }>()
  const [active, setActive] = useState<number>()
  const { catalog } = useLoadouts()
  const { loadout, lockedProvider, setLoadout } = useThreadLoadout(threadId)
  const { accessMode, setAccessMode } = useAccessMode()
  const { skills: listed, refresh } = useSkills(projectId)
  const capabilities = useProviderCapabilities()
  const compactThread = useCompactThread()
  const thread = useThreadMeta(threadId)
  const context = useThreadContext(threadId)
  const bumpDraft = useBumpDraft()
  const navigate = useNavigate()
  const model = loadout && findModel(catalog, loadout)
  const name = loadout && catalogModelName(catalog, loadout.provider, loadout.model)
  const models = lockedProvider
    ? catalog.filter((item) => item.provider === lockedProvider)
    : catalog
  const provider = loadout?.provider ?? lockedProvider
  // Claude and Grok run Claude skills as /name; Codex has its own. Bots run on Claude.
  const runsSkills = bot || provider !== 'codex'
  const skills = runsSkills ? listed : []

  // A finished chip is one piece: the caret resting in it neither un-chips it nor opens the menu.
  const all = chips(text, skills, mentions)
  const typed = activeSlash(text, caret)
  const query =
    typed &&
    (typed.trigger === '/' || mentions.length > 0) &&
    (typed.start === editing || !all.some((token) => token.start === typed.start))
      ? typed
      : undefined
  const open = focused && query !== undefined && dismissed !== query.start
  const own = level && level.start === query?.start ? level : undefined
  const section = own?.section
  const picking = own?.picking
  const tokens = all.filter((token) => token.start !== query?.start)
  const shown = chipped(text, tokens)

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  // Loaded with the composer, so a first chip doesn't paint a frame at the fallback width.
  useEffect(() => void document.fonts.load('1em "Skill Chip"', chipLead), [])

  // Programmatic edits move the caret in state; user edits already match it. Text replaced from
  // outside (a send, another thread's draft) keeps the caret where the browser put it.
  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    if (seen.current !== text) {
      seen.current = text
      setEditing(undefined)
      settle(text, element.selectionStart)
    } else if (element.selectionStart !== caret) element.setSelectionRange(caret, caret)
  }, [textarea, text, caret])

  function settle(next: string, nextCaret: number) {
    setCaret(nextCaret)
    setActive(undefined)
    if (!activeSlash(next, nextCaret)) {
      setDismissed(undefined)
      setLevel(undefined)
    }
  }

  // Typing in a slash word makes it the one being edited; deleting the space after a chip doesn't.
  function update(next: string, nextCaret: number) {
    const word = activeSlash(next, nextCaret)
    setEditing(
      word && (word.start === editing || wordAt(text, word.start) !== wordAt(next, word.start))
        ? word.start
        : undefined
    )
    seen.current = next
    onTextChange(next)
    settle(next, nextCaret)
  }

  // Skills and bots go into the message, followed by a space for what comes next.
  function insert(range: SlashQuery, name: string) {
    const after = text.slice(range.end).replace(/^ /, '')
    const head = `${text.slice(0, range.start)}${range.trigger}${name} `
    update(head + after, head.length)
  }

  // Jetty commands apply here, so their slash leaves no trace in the message.
  function consume(range: SlashQuery) {
    update(text.slice(0, range.start) + text.slice(range.end), range.start)
  }

  // Each level change clears what was typed after the slash, so the new list starts unfiltered.
  function go(
    range: SlashQuery,
    next: { section?: Section; picking?: ValueCommand; active?: number }
  ) {
    if (range.query)
      update(`${text.slice(0, range.start)}/${text.slice(range.end)}`, range.start + 1)
    setLevel({ start: range.start, section: next.section, picking: next.picking })
    setActive(next.active)
  }

  function swapModel(next: ProviderModel) {
    const { provider, model: id, effort, fast } = equipModel(loadout ?? { fast: false }, next)
    setLoadout({ provider, model: id, effort, fast })
  }

  function optionEntries(range: SlashQuery, command: ValueCommand): Entry[] {
    const option = (
      id: string,
      name: string,
      description: string,
      selected: boolean,
      apply: () => void,
      icon: ReactNode
    ): Entry => ({
      id: `${command}:${id}`,
      kind: 'option',
      name,
      description,
      group: commandLabels[command],
      icon,
      selected,
      score: 0,
      run: () => {
        apply()
        consume(range)
      },
    })
    if (command === 'model')
      return models.map((entry) =>
        option(
          modelKey(entry),
          modelLabelText(entry),
          '',
          model === entry,
          () => swapModel(entry),
          <ProviderGlyph provider={entry.provider} className='size-3' />
        )
      )
    if (command === 'effort')
      return (model?.efforts ?? []).map((effort) =>
        option(
          effort,
          effortLabels[effort],
          '',
          effort === loadout?.effort,
          () => loadout && setLoadout({ ...loadout, effort }),
          <GaugeIcon />
        )
      )
    return (['auto', 'full_access'] as const).map((mode) =>
      option(
        mode,
        accessLabels[mode],
        accessDescriptions[mode],
        mode === accessMode,
        () => setAccessMode(mode),
        mode === 'auto' ? <ShieldCheckIcon /> : <ShieldOffIcon />
      )
    )
  }

  function commandEntries(range: SlashQuery): Entry[] {
    const command = (
      id: string,
      name: string,
      description: string,
      icon: ReactNode,
      opens: boolean,
      run: () => void,
      disabled = false
    ): Entry => ({
      id: `command:${id}`,
      kind: 'command',
      name,
      description,
      group: 'Commands',
      icon,
      opens,
      disabled,
      score: 0,
      run,
    })
    const picker = (id: ValueCommand) => () => go(range, { picking: id })
    const compactReason = !thread?.provider
      ? ''
      : thread.status === 'starting' ||
          thread.status === 'running' ||
          thread.status === 'awaiting_approval'
        ? 'Wait for this turn to finish'
        : !capabilities?.[thread.provider].compaction
          ? 'This provider can’t compact'
          : ''
    const unset = 'Choose a model first'
    const efforts = model?.efforts.length ?? 0
    const choosable = model?.autoMode !== false
    return [
      command('model', 'Model', '', <BrainIcon />, true, picker('model')),
      command(
        'effort',
        'Effort',
        efforts ? '' : loadout ? `${name} has no effort levels` : unset,
        <GaugeIcon />,
        true,
        picker('effort'),
        !efforts
      ),
      command(
        'fast',
        'Fast',
        model?.fast ? '' : loadout ? `${name} has no fast mode` : unset,
        <FlashIcon filled={loadout?.fast} />,
        false,
        () => {
          consume(range)
          if (loadout) setLoadout({ ...loadout, fast: !loadout.fast })
        },
        !model?.fast
      ),
      command(
        'access',
        'Access',
        choosable ? '' : `${model.name} only supports asking first`,
        <ShieldCheckIcon />,
        true,
        picker('access'),
        !choosable
      ),
      ...(context && context.usedTokens > 0
        ? [
            command(
              'compact',
              'Compact',
              compactReason,
              <ContextRing context={context} />,
              false,
              () => {
                consume(range)
                if (threadId) compactThread(threadId)
              },
              Boolean(compactReason)
            ),
          ]
        : []),
      ...(onUsage
        ? [
            command(
              'usage',
              'Usage',
              provider ? '' : unset,
              <ChartHistogramIcon />,
              false,
              () => {
                consume(range)
                onUsage()
              },
              !provider
            ),
          ]
        : []),
      command('new', 'New thread', '', <PencilEdit02Icon />, false, () => {
        consume(range)
        bumpDraft()
        void navigate({ to: '/' })
      }),
    ]
  }

  function itemEntries(range: SlashQuery): Entry[] {
    return [
      ...(bot ? [] : commandEntries(range)),
      ...listed.map(
        (skill): Entry => ({
          id: `skill:${skill.name}`,
          kind: 'skill',
          name: skill.name,
          description: runsSkills ? skill.description : 'Codex can’t run Claude skills',
          group: 'Skills',
          icon: <AiFileIcon />,
          disabled: !runsSkills,
          score: 0,
          run: () => insert(range, skill.name),
        })
      ),
    ]
  }

  function mentionEntries(range: SlashQuery): Entry[] {
    return mentions.map((mention) => ({
      id: `bot:${mention.id}`,
      kind: 'bot',
      name: mention.name,
      description: '',
      group: 'Bots',
      icon: <BotAvatar bot={mention} size={12} unread={false} />,
      score: 0,
      run: () => insert(range, mention.name),
    }))
  }

  function back(run: () => void): Entry {
    return { id: 'back', kind: 'back', name: 'Back', description: '', group: '', score: 0, run }
  }

  // Back lands on the row you came from: the command, or the Skills row after the commands.
  function up(range: SlashQuery) {
    if (picking) go(range, { active: commandOrder.indexOf(picking) })
    else if (section) go(range, { active: commandEntries(range).length })
  }

  function entriesFor(range: SlashQuery): Entry[] {
    if (range.trigger === '@') return rank(mentionEntries(range), range.query)
    if (picking) return [back(() => up(range)), ...rank(optionEntries(range, picking), range.query)]
    const items = itemEntries(range)
    if (section)
      return [
        back(() => up(range)),
        ...rank(
          items.filter((entry) => entry.group === section),
          range.query
        ),
      ]
    if (range.query || bot) return rank(items, range.query)
    const skills = items.filter((entry) => entry.group === 'Skills')
    return [
      ...items.filter((entry) => entry.group === 'Commands'),
      ...(skills.length
        ? [
            {
              id: 'section:Skills',
              kind: 'section',
              name: 'Skills',
              description: '',
              group: 'Skills',
              icon: <BookOpenIcon />,
              score: 0,
              opens: true,
              run: () => go(range, { section: 'Skills' }),
            } satisfies Entry,
          ]
        : []),
    ]
  }

  const entries = open && query ? entriesFor(query) : []
  const usable = entries.flatMap((entry, at) => (entry.disabled ? [] : [at]))
  const first = usable.find((at) => entries[at]?.kind !== 'back') ?? usable[0] ?? -1
  const index = active !== undefined && usable.includes(active) ? active : first
  const current = entries[index]

  function step(direction: 1 | -1) {
    if (!usable.length) return
    const at = usable.indexOf(index)
    setActive(usable[(at + direction + usable.length) % usable.length])
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (inComposition(event.nativeEvent)) return
    const element = event.currentTarget
    const collapsed = element.selectionStart === element.selectionEnd
    if (open && query) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        step(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(query.start)
        return
      }
      if (event.key === 'Backspace' && collapsed && !query.query && (section || picking)) {
        event.preventDefault()
        up(query)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        if (current && usable.length) {
          event.preventDefault()
          current.run()
          return
        }
        if (event.key === 'Tab') return
        // Every match is disabled and says why; the half-typed command isn't a message.
        if (entries.length) {
          event.preventDefault()
          return
        }
      }
    }
    if (event.key === 'Backspace' && collapsed) {
      const token = tokens.find((entry) => entry.end === element.selectionStart)
      if (token) {
        event.preventDefault()
        update(text.slice(0, token.start) + text.slice(token.end), token.start)
      }
    }
  }

  // The textarea is the menu's combobox.
  const input = {
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': open,
    'aria-controls': open ? 'slash-menu' : undefined,
    'aria-activedescendant': current && `slash-${current.id}`,
    value: shown,
    onChange: ({ target }: ChangeEvent<HTMLTextAreaElement>) =>
      update(
        applyEdit(text, shown, target.value, target.selectionEnd, leads()),
        target.selectionStart
      ),
    onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const at = event.currentTarget.selectionStart
      if (at === caret) return
      setCaret(at)
      setActive(undefined)
      if (activeSlash(text, at)?.start !== editing) setEditing(undefined)
    },
    onFocus: () => setFocused(true),
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
    onBlur: () => {
      setFocused(false)
      setEditing(undefined)
    },
    // What leaves the textarea carries the message's slashes, not the chips' spaces.
    onCopy: (event: ClipboardEvent<HTMLTextAreaElement>) => copy(event),
    onCut: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const { selectionStart, selectionEnd } = event.currentTarget
      if (copy(event))
        update(text.slice(0, selectionStart) + text.slice(selectionEnd), selectionStart)
    },
    onScroll: (event: UIEvent<HTMLTextAreaElement>) => {
      if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop
    },
    // Capture, so an open menu takes its keys before the strip's handlers and Enter-to-send.
    onKeyDownCapture: onKeyDown,
  } satisfies ComponentProps<'textarea'>

  function leads() {
    return new Map<string, Trigger>([
      ...skills.map((skill) => [skill.name, '/'] as const),
      ...mentions.map((mention) => [mention.name, '@'] as const),
    ])
  }

  function copy(event: ClipboardEvent<HTMLTextAreaElement>) {
    const { selectionStart, selectionEnd } = event.currentTarget
    const selected = text.slice(selectionStart, selectionEnd)
    if (selected === shown.slice(selectionStart, selectionEnd)) return false
    event.preventDefault()
    event.clipboardData.setData('text/plain', selected)
    return true
  }

  return {
    shown,
    tokens,
    query,
    open,
    composing,
    entries,
    index,
    field,
    mirror,
    anchor,
    input,
    setActive,
  }
}

export type Slash = ReturnType<typeof useComposerSlash>

function rank(entries: Entry[], query: string) {
  const scored = entries.flatMap((entry) => {
    const score = matchScore(entry.name, entry.description, query)
    return score === undefined ? [] : [{ ...entry, score }]
  })
  return scored.sort(
    (a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || b.score - a.score
  )
}

function wordAt(text: string, at: number) {
  return /^\S*/.exec(text.slice(at))?.[0]
}

function chips(text: string, skills: readonly Skill[], bots: readonly MentionBot[]) {
  return [
    ...slashTokens(text).filter((token) => skills.some((skill) => skill.name === token.name)),
    ...mentionTokens(text, bots),
  ].sort((a, b) => a.start - b.start)
}

/* Mirror: paints the textarea's text, chips and all, behind its transparent text. */

export function SlashMirror({ slash, className }: { slash: Slash; className?: string }) {
  const { shown, tokens, query, anchor, mirror } = slash
  const parts: ReactNode[] = []
  let at = 0
  const marks = [
    ...tokens.map((token) => ({ ...token, anchor: false })),
    ...(query ? [{ start: query.start, end: query.start, name: '', anchor: true }] : []),
  ].sort((a, b) => a.start - b.start)
  for (const mark of marks) {
    parts.push(shown.slice(at, mark.start))
    if (mark.anchor) parts.push(<span key='anchor' ref={anchor} />)
    else
      parts.push(
        <span
          key={mark.start}
          className={cn('skill-chip', mark.bot && 'bot-chip')}
          style={mark.bot && botColorStyle(mark.bot.color)}
          // A mention can end on punctuation, with no en space after it to hold the padding.
          data-flush={/\S/.test(shown.charAt(mark.end)) || undefined}
        >
          <span className='whitespace-nowrap'>
            {mark.bot ? (
              <JettyBot shape={mark.bot.shape} color={mark.bot.color} size={14} />
            ) : (
              <AiFileIcon />
            )}
            {chipLead}
          </span>
          {mark.name}
        </span>
      )
    at = mark.end
  }
  parts.push(shown.slice(at))

  return (
    <div
      ref={mirror}
      aria-hidden='true'
      className={cn(
        'skill-chip-text skill-chip-mirror pointer-events-none absolute inset-0 scroll-fade-y px-2.5 py-2 text-base break-words whitespace-pre-wrap md:text-sm',
        className
      )}
    >
      {parts}
      {/* Gives a trailing newline its line, as the textarea does, so the two scroll alike. */}
      {'​'}
    </div>
  )
}

/* Menu */

export function SlashMenu({ slash }: { slash: Slash }) {
  const popup = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const mentioning = slash.query?.trigger === '@'
  useLayoutEffect(() => {
    const anchor = slash.anchor.current
    const field = slash.field.current
    const mirror = slash.mirror.current
    if (!popup.current || !anchor || !field || !mirror) return
    popup.current.style.left = `${Math.max(0, Math.min(anchor.offsetLeft - 8, field.offsetWidth - popup.current.offsetWidth))}px`
    popup.current.style.top = `${anchor.offsetTop - mirror.scrollTop - 6}px`
  })
  useLayoutEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [slash.index, slash.entries.length])

  return (
    <div
      ref={popup}
      className='absolute z-50 w-80 origin-bottom-left -translate-y-full overflow-hidden rounded-sm bg-popover text-popover-foreground shadow-md ring-1 ring-border animate-(--motion-popup-enter) slide-in-from-bottom-1 fade-in-60 motion-reduce:animate-none'
    >
      <div
        id='slash-menu'
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- preserve the sketchpad's div-based list markup
        role='listbox'
        aria-label={mentioning ? 'Bots' : 'Slash commands'}
        ref={list}
        className='scroll-fade-y scrollbar-subtle max-h-72 scroll-py-1 overflow-y-auto overscroll-contain p-1'
      >
        {slash.entries.length === 0 && (
          <p className='flex h-menu-item-compact items-center px-2 text-xs text-muted-foreground'>
            No {mentioning ? 'bots' : 'skills'} match “{slash.query?.trigger}
            {slash.query?.query}”
          </p>
        )}
        {slash.entries.map((entry, index) => (
          <Row key={entry.id} slash={slash} entry={entry} index={index} />
        ))}
      </div>
    </div>
  )
}

function Row({ slash, entry, index }: { slash: Slash; entry: Entry; index: number }) {
  const props = {
    id: `slash-${entry.id}`,
    role: 'option',
    'aria-selected': index === slash.index,
    'aria-disabled': entry.disabled || undefined,
    'data-active': index === slash.index ? '' : undefined,
    'data-disabled': entry.disabled ? '' : undefined,
    onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
    onMouseMove: () => {
      if (index !== slash.index && !entry.disabled) slash.setActive(index)
    },
    onClick: entry.disabled ? undefined : entry.run,
  } as const
  const row =
    "flex cursor-default items-center gap-2 rounded-menu-item px-2 text-xs select-none data-active:bg-accent data-active:text-accent-foreground data-disabled:cursor-not-allowed data-disabled:text-disabled-foreground data-disabled:[&_svg]:text-disabled-foreground [&_svg]:size-3 [&_svg]:shrink-0 [&:not([data-active],[data-disabled])>:where(svg,.provider-icon):not([class*='text-'])]:text-muted-foreground"

  if (entry.kind === 'back')
    return (
      <div {...props} className={`${row} h-menu-item-compact text-muted-foreground`}>
        <ArrowLeft01Icon />
        Backspace to go back
      </div>
    )

  return (
    <div {...props} className={`${row} h-menu-item-compact`}>
      {entry.icon}
      <span className='shrink-0'>{entry.name}</span>
      <span className='min-w-0 flex-1 truncate text-muted-foreground'>{entry.description}</span>
      {entry.kind === 'option' && entry.selected && <Tick02Icon className='text-current' />}
      {entry.opens && <ArrowRight01Icon className='text-muted-foreground' />}
    </div>
  )
}
