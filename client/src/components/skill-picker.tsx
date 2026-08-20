import type { Skill } from '@jetty/shared/wire'

import { skillsStore } from '@/app-state'
import { usePromptInputController } from '@/components/ai-elements/prompt-input'
import { caretViewportRect } from '@/lib/caret'
import { filterSkills, insertSkill, slashQueryAt } from '@/lib/slash-skill'
import { cn } from '@/lib/utils'
import {
  cloneElement,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'

const MAX_VISIBLE = 8

type FieldProps = {
  ref?: Ref<HTMLTextAreaElement>
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onKeyUp?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onClick?: () => void
  onInput?: () => void
  onSelect?: () => void
}

export function SkillSlashField({
  projectId,
  children,
}: {
  projectId: string | null
  children: ReactNode
}) {
  const { textInput } = usePromptInputController()
  const skills = useSyncExternalStore(skillsStore.subscribe, () => skillsStore.getFor(projectId))
  const wrapRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const slash = slashQueryAt(textInput.value, caret)
  const slashToken = slash ? slashKey(slash) : null
  const matches = slash ? filterSkills(skills, slash.query).slice(0, MAX_VISIBLE) : []
  const open = slashToken !== null && matches.length > 0 && dismissed !== slashToken

  function fieldTextarea(): HTMLTextAreaElement | null {
    return textareaRef.current ?? wrapRef.current?.querySelector('textarea') ?? null
  }

  const syncCaret = useCallback(() => {
    const el = textareaRef.current ?? wrapRef.current?.querySelector('textarea')
    if (el) setCaret(el.selectionStart)
  }, [])

  useEffect(() => {
    setActive(0)
  }, [slashToken])

  useEffect(() => {
    if (!open || !slashToken) return
    function onPointerDown(event: PointerEvent) {
      const node = event.target
      if (!(node instanceof Node)) return
      if (wrapRef.current?.contains(node) || textareaRef.current?.contains(node)) return
      if (node instanceof Element && node.closest('[data-slot=skill-picker]')) return
      setDismissed(slashToken)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, slashToken])

  function apply(skill: Skill) {
    const current = slashQueryAt(textInput.value, caret)
    if (!current) return
    const el = fieldTextarea()
    const next = insertSkill(textInput.value, current, caret, skill.name)
    textInput.setInput(next)
    const tokenEnd = current.start + skill.name.length + 1
    const cursor = next[tokenEnd] === ' ' ? tokenEnd + 1 : tokenEnd
    setDismissed(null)
    setActive(0)
    queueMicrotask(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(cursor, cursor)
      setCaret(cursor)
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    syncCaret()
    if (event.key === 'Escape' && slashToken) {
      setDismissed(slashToken)
      event.preventDefault()
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % matches.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + matches.length) % matches.length)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const skill = matches[active] ?? matches[0]
      if (!skill) return
      event.preventDefault()
      apply(skill)
    }
  }

  const child = isValidElement(children) ? (children as ReactElement<FieldProps>) : null
  const field = child
    ? cloneElement(child, {
        ref: textareaRef,
        onKeyDown,
        onKeyUp: syncCaret,
        onClick: syncCaret,
        onInput: syncCaret,
        onSelect: syncCaret,
      })
    : children

  return (
    <div ref={wrapRef} className='contents'>
      {field}
      {open && slash && (
        <SkillMenu
          textarea={fieldTextarea()}
          caret={slash.start}
          skills={matches}
          active={Math.min(active, matches.length - 1)}
          onHover={setActive}
          onPick={apply}
        />
      )}
    </div>
  )
}

function slashKey(slash: { start: number; query: string }): string {
  return `${slash.start}:${slash.query}`
}

function SkillMenu({
  textarea,
  caret,
  skills,
  active,
  onHover,
  onPick,
}: {
  textarea: HTMLTextAreaElement | null
  caret: number
  skills: Skill[]
  active: number
  onHover: (index: number) => void
  onPick: (skill: Skill) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu || !textarea) return
    const caretRect = caretViewportRect(textarea, caret)
    const width = Math.min(Math.max(textarea.clientWidth, 240), 420)
    menu.style.width = `${width}px`
    const left = Math.min(caretRect.left, window.innerWidth - width - 8)
    menu.style.left = `${Math.max(8, left)}px`
    const gap = 6
    const height = menu.offsetHeight
    const above = caretRect.top - gap - height
    menu.style.top = `${above >= 8 ? above : caretRect.top + caretRect.height + gap}px`
  }, [textarea, caret, skills, active])

  return createPortal(
    <div
      ref={menuRef}
      data-slot='skill-picker'
      className={cn(
        'fixed z-50 max-h-64 overflow-y-auto rounded-lg p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10',
        'bg-popover/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-lg before:backdrop-saturate-150'
      )}
    >
      {skills.map((skill, index) => (
        <button
          key={skill.name}
          type='button'
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-hidden',
            index === active && 'bg-foreground/10'
          )}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(skill)
          }}
        >
          <span className='shrink-0'>{skill.name}</span>
          {skill.description.length > 0 && (
            <span className='min-w-0 truncate text-muted-foreground'>{skill.description}</span>
          )}
        </button>
      ))}
    </div>,
    document.body
  )
}
