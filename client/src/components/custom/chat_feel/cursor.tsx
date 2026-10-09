import { useMemo, useState } from 'react'
import { Block, type BlockProps } from 'streamdown'

import type { StreamFeel } from './jetty'

import { wholeWords, type Pacing } from '../smooth_stream'

// Cursor's streaming, rebuilt from ~/code/scratch/teardowns/chat-cursor.md. Every frame shows at
// least 24 characters or an eighth of what's behind, cut on a word, so text trails by at most
// about 8 frames. New words fade in over 150ms, linear, in the tail block only. Code never fades,
// and there's no caret.
const pacing: Pacing = { lump: 0, ms: 0, chars: 24, count: 8, steady: false }

const fadeMs = 150
// A block that stops being the tail keeps fading for a fade and two frames, so its words finish.
const tailMs = fadeMs + 34

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

// When each stretch of a block's rendered text first showed, as character offsets.
type Clock = {
  index: number
  text: string
  births: { from: number; at: number }[]
  settle: boolean
}

// The last block yet shown, and when each earlier one stopped being it.
type Tail = { index: number; left: number[] }

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  let text = ''
  for (const child of node.children ?? []) text += textOf(child)
  return text
}

// Never faded, as in Cursor: code blocks, drawings and maths show whole.
const still = new Set(['pre', 'svg', 'math'])

// Inline elements whose text can't be split: code chips, and links that render their own label.
function atomic(tagName: string) {
  return tagName === 'code' || tagName === 'img' || tagName.includes('-')
}

let plugins = 0

// Streamdown caches a processor per plugin name, so each block's needs a name of its own.
function fadePlugin(clock: Clock, tail: Tail) {
  const plugin = () => fade
  Object.defineProperty(plugin, 'name', { value: `cursorFade${plugins++}` })
  return plugin

  function fade(tree: HastNode) {
    const now = performance.now()
    if (clock.index > tail.index) {
      for (let index = Math.max(0, tail.index); index < clock.index; index++) tail.left[index] = now
      tail.index = clock.index
    }
    const live = clock.index === tail.index || now - (tail.left[clock.index] ?? -Infinity) < tailMs
    const text = textOf(tree)
    let same = 0
    while (same < text.length && text[same] === clock.text[same]) same++
    clock.text = text
    if (same < text.length) clock.births = clock.births.filter((birth) => birth.from < same)
    if (clock.settle) clock.settle = false
    else if (live && same < text.length) clock.births.push({ from: same, at: now })
    const births = clock.births
    if (births.length === 0) return
    // Every stretch keeps its span for good, so React keeps each element and its running fade.
    const span = (at: number, children: HastNode[]): HastNode => ({
      type: 'element',
      tagName: 'span',
      properties: now - at < fadeMs ? { className: ['cursor-fade'] } : {},
      children,
    })

    // The birth an offset's text came in with, if any, searched on from the last offset's.
    let birth = -1
    function birthAt(offset: number) {
      while (birth + 1 < births.length && births[birth + 1]!.from <= offset) birth++
      return birth
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
        const tagName = child.tagName ?? ''
        if (still.has(tagName)) {
          offset += textOf(child).length
          children.push(child)
        } else if (atomic(tagName)) {
          const at = births[birthAt(offset)]?.at
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
// mid-reply) shows at once; words after that fade while their block is the tail. `mounted` ends
// the mount.
function smoothBlocks(text: string) {
  const clocks: Clock[] = []
  const tail: Tail = { index: -1, left: [] }
  let mounting = text.length > 0
  function SmoothBlock({ rehypePlugins, ...props }: BlockProps) {
    const { index } = props
    const [clock] = useState(
      () => clocks[index] ?? (clocks[index] = { index, text: '', births: [], settle: mounting })
    )
    const plugins = useMemo(
      () => [...(rehypePlugins ?? []), fadePlugin(clock, tail)],
      [rehypePlugins, clock]
    )
    return <Block {...props} rehypePlugins={plugins} />
  }
  return { SmoothBlock, mounted: () => void (mounting = false) }
}

export const stream: StreamFeel = { smoothBlocks, wholeWords, pacing }
