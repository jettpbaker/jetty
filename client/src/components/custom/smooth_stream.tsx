import type { StreamingStyle } from '@/lib/streaming_style'

import { useMemo, useState } from 'react'
import { Block, type BlockProps } from 'streamdown'

import './smooth_stream.css'

// Smooth streaming, measured off a streaming UI that reads as smooth: every batch fades in whole
// over 600ms ease-out, no stagger, so fades overlap and a pause in the network reads as a slowdown
// rather than a stop. Words are never shown half-written, so none starts at a line's end and
// jumps to the next once it's complete.

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

type Reveal = { className: string; duration: number }

const reveals: Record<Exclude<StreamingStyle, 'off'>, Reveal> = {
  fade: { className: 'smooth-fade', duration: 600 },
  quick: { className: 'smooth-fade', duration: 300 },
  blur: { className: 'smooth-blur', duration: 600 },
  softBlur: { className: 'smooth-blur-soft', duration: 600 },
}

// When each stretch of a block's rendered text first showed, as character offsets.
type Clock = { text: string; births: { from: number; at: number }[]; settle: boolean }

// While streaming, text up to its last whole word.
export function wholeWords(text: string) {
  return /\s$/.test(text) ? text : text.slice(0, text.search(/\S+$/))
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

let plugins = 0

// Streamdown caches a processor per plugin name, so each block's needs a name of its own.
function revealPlugin(clock: Clock, { className, duration }: Reveal) {
  const plugin = () => reveal
  Object.defineProperty(plugin, 'name', { value: `smoothReveal${plugins++}` })
  return plugin

  function reveal(tree: HastNode) {
    const now = performance.now()
    const text = textOf(tree)
    // Text from where this render first differs is new, re-parsed text included.
    let same = 0
    while (same < text.length && text[same] === clock.text[same]) same++
    clock.text = text
    if (clock.settle) clock.settle = false
    else if (same < text.length) {
      clock.births = clock.births.filter((birth) => birth.from < same)
      clock.births.push({ from: same, at: now })
    }
    const births = clock.births
    if (births.length === 0) return
    // Every stretch keeps its own span for good, so React keeps each one's element, and with it
    // its running fade, from render to render. Spans whose fade is over just drop the class.
    const span = (at: number, children: HastNode[]): HastNode => ({
      type: 'element',
      tagName: 'span',
      properties:
        now - at < duration
          ? { className: [className], style: `animation-duration:${duration}ms` }
          : {},
      children,
    })

    // The birth still fading at an offset, if any.
    function fadingAt(offset: number) {
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
          for (let index = fadingAt(offset); from < end; index++) {
            const to = Math.min(end, births[index + 1]?.from ?? Infinity)
            const value = child.value!.slice(from - offset, to - offset)
            if (index < 0) children.push({ type: 'text', value })
            else children.push(span(births[index]!.at, [{ type: 'text', value }]))
            from = to
          }
          offset = end
        } else if (child.tagName === 'pre') {
          offset += textOf(child).length
          children.push(child)
        } else if (child.tagName && atomic(child.tagName)) {
          // Chips and links that draw their own content fade whole, background and all.
          const index = fadingAt(offset)
          offset += textOf(child).length
          children.push(index < 0 ? child : span(births[index]!.at, [child]))
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
export function smoothBlocks(text: string, style: Exclude<StreamingStyle, 'off'>) {
  const reveal = reveals[style]
  const clocks: Clock[] = []
  let mounting = text.length > 0
  function SmoothBlock({ rehypePlugins, ...props }: BlockProps) {
    const { index } = props
    const [clock] = useState(() => (clocks[index] ??= { text: '', births: [], settle: mounting }))
    const plugins = useMemo(
      () => [...(rehypePlugins ?? []), revealPlugin(clock, reveal)],
      [rehypePlugins, clock]
    )
    return <Block {...props} rehypePlugins={plugins} />
  }
  return { SmoothBlock, mounted: () => void (mounting = false) }
}
