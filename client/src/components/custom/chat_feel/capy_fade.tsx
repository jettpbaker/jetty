import { useLayoutEffect, useMemo } from 'react'
import { Block, type BlockProps } from 'streamdown'

// Capy's text arrival: no typewriter and no caret. Text lands as it comes, and each new stretch
// fades its colour, not its opacity, so layout never waits on it. The fade is the CSS Custom
// Highlight API: a stretch steps through `steps` highlights, each a shade of the text's ink on an
// ease-out, over a time fitted to how fast chunks arrive.

const steps = 24
// Text that keeps its own look or acts as a control never fades.
const excluded = 'pre, code, button, svg, .katex'
// Elements a block renders at the top of the message, which carry its marker.
const markable = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'hr'])

type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

// One chunk's text, as character offsets into the message's text, and the shade it shows in.
type Segment = {
  from: number
  to: number
  at: number
  ms: number
  step: number
  ranges: StaticRange[]
}

type Fader = {
  container?: Element
  text: string
  segments: Segment[]
  // The time between chunks, smoothed, and when the last one landed.
  gap: number
  last?: number
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const supported = typeof Highlight !== 'undefined' && 'highlights' in CSS

let shades: Highlight[] | undefined

// The highlights and their colours, made on first use: step i shows (1 - (1 - i/24)^1.6) of the ink.
function shade(step: number) {
  if (!shades) {
    let rules = ''
    shades = []
    for (let index = 0; index < steps; index++) {
      const highlight = new Highlight()
      CSS.highlights.set(`capy-fade-${index}`, highlight)
      shades.push(highlight)
      const share = (1 - (1 - index / steps) ** 1.6) * 100
      rules += `:root[data-chat-feel='capy'] ::highlight(capy-fade-${index}) { color: color-mix(in oklab, var(--capy-ink) ${share.toFixed(1)}%, transparent); }\n`
    }
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(rules)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  }
  return shades[step]!
}

function stepAt(segment: Segment, now: number) {
  return Math.max(0, Math.min(steps, Math.floor(((now - segment.at) / segment.ms) * steps)))
}

// Moves a segment to a shade; `steps` is none, fully shown.
function show(segment: Segment, step: number) {
  if (segment.step < steps) for (const range of segment.ranges) shade(segment.step).delete(range)
  segment.step = step
  if (step < steps) for (const range of segment.ranges) shade(step).add(range)
}

const fading = new Set<Fader>()
let frame = 0

function tick(now: number) {
  for (const fader of fading) {
    for (const segment of fader.segments) {
      const step = stepAt(segment, now)
      if (step !== segment.step) show(segment, step)
    }
    fader.segments = fader.segments.filter((segment) => segment.step < steps)
    if (fader.segments.length === 0) fading.delete(fader)
  }
  frame = fading.size > 0 ? requestAnimationFrame(tick) : 0
}

// The message's text nodes in order, outside excluded elements, with where each starts.
function textOf(container: Element) {
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    (node) =>
      node instanceof Text
        ? NodeFilter.FILTER_ACCEPT
        : (node as Element).matches(excluded)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP
  )
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text
    nodes.push(textNode)
    starts.push(text.length)
    text += textNode.data
  }
  return { nodes, starts, text }
}

// One range per text node the stretch covers, so excluded text between never takes its shade.
function rangesFor(nodes: Text[], starts: number[], from: number, to: number) {
  let low = 0
  let high = nodes.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle]! <= from) low = middle
    else high = middle - 1
  }
  const ranges: StaticRange[] = []
  for (let index = low; index < nodes.length && starts[index]! < to; index++) {
    const node = nodes[index]!
    const start = Math.max(0, from - starts[index]!)
    const end = Math.min(node.length, to - starts[index]!)
    if (end > start)
      ranges.push(
        new StaticRange({
          startContainer: node,
          startOffset: start,
          endContainer: node,
          endOffset: end,
        })
      )
  }
  return ranges
}

// After each render: text past what the message showed before is a new chunk. It continues the
// last segment when it carries on a word that segment is less than a quarter into, and a message of
// 64 characters or fewer fades in whole. `settle` takes what's there as already shown.
function sync(fader: Fader, container: Element, settle: boolean) {
  const now = performance.now()
  const { nodes, starts, text } = textOf(container)
  let same = 0
  while (same < text.length && text[same] === fader.text[same]) same++
  fader.text = text
  for (const segment of fader.segments) {
    show(segment, steps)
    segment.to = Math.min(segment.to, same)
  }
  const segments = fader.segments.filter((segment) => segment.from < segment.to)
  if (same < text.length && !settle) {
    if (fader.last !== undefined)
      fader.gap = fader.gap * 0.7 + Math.min(now - fader.last, 1000) * 0.3
    fader.last = now
    const first = segments[0]
    const last = segments.at(-1)
    if (text.length <= 64 && first?.from === 0) {
      first.to = text.length
      segments.length = 1
    } else if (
      last?.to === same &&
      now - last.at < last.ms / 4 &&
      /\S/.test(text[same - 1]!) &&
      /\S/.test(text[same]!)
    )
      last.to = text.length
    else
      segments.push({
        from: same,
        to: text.length,
        at: now,
        ms: Math.min(720, Math.max(280, fader.gap * 8)),
        step: steps,
        ranges: [],
      })
  }
  for (const segment of segments) {
    segment.ranges = rangesFor(nodes, starts, segment.from, segment.to)
    show(segment, stepAt(segment, now))
  }
  fader.segments = segments.filter((segment) => segment.step < steps)
  if (fader.segments.length === 0) return
  fading.add(fader)
  if (!frame) frame = requestAnimationFrame(tick)
}

let messages = 0

// Marks the block's top-level elements, so the message's container can be found from any of them.
function markPlugin(id: string) {
  const plugin = () => (tree: HastNode) => {
    for (const child of tree.children ?? [])
      if (child.type === 'element' && markable.has(child.tagName!))
        child.properties = { ...child.properties, dataCapyFade: id }
  }
  // Streamdown caches a processor per plugin name.
  Object.defineProperty(plugin, 'name', { value: id })
  return plugin
}

// A BlockComponent for one streaming message. Text it already had when it mounted (a thread opened
// mid-reply) shows at once; everything after fades. `mounted` ends the mount.
export function capyBlocks(text: string) {
  const id = `capy-message-${messages++}`
  const fader: Fader = { text: '', segments: [], gap: 160 }
  const mark = markPlugin(id)
  let settle = text.length > 0
  function SmoothBlock({ rehypePlugins, ...props }: BlockProps) {
    const plugins = useMemo(() => [...(rehypePlugins ?? []), mark], [rehypePlugins])
    useLayoutEffect(() => {
      if (!supported || reducedMotion.matches) return
      if (!fader.container?.isConnected)
        fader.container =
          document.querySelector(`[data-capy-fade="${id}"]`)?.parentElement ?? undefined
      if (fader.container) sync(fader, fader.container, settle)
    })
    return <Block {...props} rehypePlugins={plugins} />
  }
  return { SmoothBlock, mounted: () => void (settle = false) }
}
