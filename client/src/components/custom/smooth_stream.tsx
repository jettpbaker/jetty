import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Block, type BlockProps } from 'streamdown'

import './smooth_stream.css'

// Smooth streaming, measured off a streaming UI that reads as smooth: every batch fades in whole
// over 600ms ease-out, no stagger, so fades overlap and a pause in the network reads as a slowdown
// rather than a stop. Words are never shown half-written, so none starts at a line's end and
// jumps to the next once it's complete.

export const fadeMs = 600

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

// When each stretch of a block's rendered text first showed, as character offsets.
type Clock = {
  text: string
  births: { from: number; at: number }[]
  settle: boolean
  shown: boolean
}

// While streaming, text up to its last whole word, without a list item that has no words yet.
export function wholeWords(text: string) {
  const whole = /\s$/.test(text) ? text : text.slice(0, text.search(/\S+$/))
  return whole.replace(/(^|\n)[ \t]*(?:[-*+>]|\d+[.)])[ \t]*$/, '$1')
}

// Inline style for an element whose fade began `age` ms ago, so one made again carries on.
export function fadeStyle(age = 0) {
  return `--fade:${fadeMs}ms;--fade-delay:${-Math.round(age)}ms`
}

// A reply that lands in a lump (Claude often sends one written after a tool call all at once)
// shows a step at a time, like a fast stream: a server batch apart, and all of it within 1.5s.
const step = { ms: 50, chars: 50, count: 30 }

// Where the word at or after `index` starts.
function wordStart(text: string, index: number) {
  const space = text.slice(index).search(/\s\S/)
  return space === -1 ? text.length : index + space + 1
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

// How much of `text` to show, from `from` characters at mount: all of it, unless it has run ahead
// by more than a step. No `from`, no pacing.
export function usePacedText(text: string, from?: number) {
  const [shown, setShown] = useState(from ?? 0)
  const latest = useRef(text)
  useLayoutEffect(() => {
    latest.current = text
  }, [text])
  const behind = from === undefined ? 0 : text.length - shown
  if (behind < 0 || (behind > 0 && (behind <= step.chars || reducedMotion.matches)))
    setShown(text.length)
  const pacing = behind > step.chars && !reducedMotion.matches
  useEffect(() => {
    if (!pacing) return
    // Steps keep the size the lump started at, so it lands at an even pace.
    let size = 0
    const timer = setInterval(() => {
      const text = latest.current
      setShown((shown) => {
        size = Math.max(size, step.chars, Math.ceil((text.length - shown) / step.count))
        return wordStart(text, shown + size)
      })
    }, step.ms)
    return () => clearInterval(timer)
  }, [pacing])
  return pacing ? wholeWords(text.slice(0, shown)) : text
}

// How much of each reply has shown in this window, and when, so one mounted again (the reply moving
// into Working, its thread switched back to) doesn't roll in again.
const shownReplies = new Map<string, { length: number; at: number }>()

// What a reply showed if it was showing a moment ago, so a remount carries on its roll-in; all of
// it if longer ago; nothing if it never showed.
export function replyShown(reply: string | undefined) {
  const shown = reply === undefined ? undefined : shownReplies.get(reply)
  if (!shown) return undefined
  return performance.now() - shown.at < 1000 ? shown.length : Infinity
}

export function useReplyShown(reply: string | undefined, length: number | undefined) {
  useEffect(() => {
    if (reply === undefined || length === undefined) return
    shownReplies.delete(reply)
    shownReplies.set(reply, { length, at: performance.now() })
    if (shownReplies.size > 100) shownReplies.delete(shownReplies.keys().next().value!)
  }, [reply, length])
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  let text = ''
  for (const child of node.children ?? []) text += textOf(child)
  return text
}

// Inline elements whose text can't be split: code chips, and links that render their own label.
function atomic(tagName: string) {
  return tagName === 'code' || tagName === 'img' || tagName.includes('-')
}

// Elements that fade with their first text, by the class that fades them.
const marks: Record<string, string> = {
  pre: 'smooth-fade',
  hr: 'smooth-fade',
  li: 'smooth-li',
  blockquote: 'smooth-blockquote',
}

let plugins = 0

// Streamdown caches a processor per plugin name, so each block's needs a name of its own.
function revealPlugin(clock: Clock) {
  const plugin = () => reveal
  Object.defineProperty(plugin, 'name', { value: `smoothReveal${plugins++}` })
  return plugin

  function reveal(tree: HastNode) {
    const now = performance.now()
    const text = textOf(tree)
    // Text from where this render first differs is new, re-parsed text included. A block that
    // shows with no text (a rule) is new too.
    let same = 0
    while (same < text.length && text[same] === clock.text[same]) same++
    const first = !clock.shown
    clock.shown = true
    clock.text = text
    if (clock.settle) clock.settle = false
    else if (same < text.length || (first && !text)) {
      clock.births = clock.births.filter((birth) => birth.from < same)
      clock.births.push({ from: same, at: now })
    }
    const births = clock.births
    if (births.length === 0) return
    // Every stretch keeps its own span for good, so React keeps each one's element, and with it
    // its running fade, from render to render. Spans whose fade is over just drop the class.
    const fading = (at: number) => now - at < fadeMs
    const fade = (at: number, className: string) => (fading(at) ? { className: [className] } : {})
    const span = (at: number, children: HastNode[]): HastNode => ({
      type: 'element',
      tagName: 'span',
      properties: fade(at, 'smooth-fade'),
      children,
    })

    // The birth an offset's text came in with, if any.
    function birthAt(offset: number) {
      for (let index = births.length - 1; index >= 0; index--)
        if (births[index]!.from <= offset) return index
      return -1
    }

    let offset = 0
    function visit(node: HastNode) {
      const children: HastNode[] = []
      for (const child of node.children ?? []) {
        if (child.type === 'text') {
          const end = offset + (child.value?.length ?? 0)
          let from = offset
          for (let index = birthAt(offset); from < end; index++) {
            const to = Math.min(end, births[index + 1]?.from ?? Infinity)
            const value = child.value!.slice(from - offset, to - offset)
            if (index < 0) children.push({ type: 'text', value })
            else children.push(span(births[index]!.at, [{ type: 'text', value }]))
            from = to
          }
          offset = end
          continue
        }
        // Bullets, numbers, quote bars, rules and code wells show with the text they came in
        // with; lines a stream adds to a code block fade on their own.
        const at = births[birthAt(offset)]?.at
        const mark = child.tagName && marks[child.tagName]
        if (mark && at !== undefined && fading(at)) {
          const properties = (child.properties ??= {})
          properties.className = [...((properties.className as string[] | undefined) ?? []), mark]
        }
        if (child.tagName === 'pre') {
          offset += textOf(child).length
          children.push(child)
        } else if (child.tagName && atomic(child.tagName)) {
          // Chips and links that draw their own content fade whole, background and all.
          offset += textOf(child).length
          children.push(at === undefined ? child : span(at, [child]))
        } else {
          if (child.type === 'element' || child.type === 'root') visit(child)
          children.push(child)
        }
      }
      node.children = children
    }
    visit(tree)
  }
}

// A BlockComponent for one streaming message. Text it already had when it mounted (a thread opened
// mid-reply) shows at once; everything after fades. `mounted` ends the mount.
export function smoothBlocks(text: string) {
  const clocks: Clock[] = []
  let mounting = text.length > 0
  function SmoothBlock({ rehypePlugins, ...props }: BlockProps) {
    const { index } = props
    const [clock] = useState(
      () => (clocks[index] ??= { text: '', births: [], settle: mounting, shown: false })
    )
    const plugins = useMemo(
      () => [...(rehypePlugins ?? []), revealPlugin(clock)],
      [rehypePlugins, clock]
    )
    return <Block {...props} rehypePlugins={plugins} />
  }
  return { SmoothBlock, mounted: () => void (mounting = false) }
}
