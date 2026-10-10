import type { CDPSession, Page } from 'playwright-core'

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createGzip } from 'node:zlib'
import { chromium } from 'playwright-core'

// bun run feel:scan <output> [fold] [each|hold|count] [transcript...]
// FEEL_ENGINE=today|v2 FEEL_TENSE_CHANGE=roll|crossfade|opencode FEEL_ROWS=animate|instant FEEL_REDUCED_MOTION=reduce
const tenseChange = process.env.FEEL_TENSE_CHANGE ?? 'crossfade'
const rows = process.env.FEEL_ROWS ?? 'animate'
const engine = process.env.FEEL_ENGINE ?? 'today'
const reducedMotion = process.env.FEEL_REDUCED_MOTION === 'reduce'
if (!['roll', 'crossfade', 'opencode'].includes(tenseChange))
  throw new Error(`Unknown tense change: ${tenseChange}`)
if (!['animate', 'instant'].includes(rows)) throw new Error(`Unknown rows: ${rows}`)
const root = resolve(import.meta.dir, '..')
const frameMs = 16.7
const viewport = { width: 1440, height: 900 }
const batchLabel = process.argv[4] ?? 'hold'
if (!['each', 'hold', 'count'].includes(batchLabel))
  throw new Error(`Unknown batch label: ${batchLabel}`)
const availableTranscripts = [
  ...new Bun.Glob('*.json').scanSync({ cwd: join(root, 'client/src/dev/replays') }),
]
  .map((file) => file.replace(/\.json$/, ''))
  .sort()
const transcripts = process.argv.length > 5 ? process.argv.slice(5) : availableTranscripts
for (const transcript of transcripts) {
  if (!availableTranscripts.includes(transcript))
    throw new Error(`Unknown transcript: ${transcript}`)
}
const fold = process.argv[3] ?? 'after-reveal'
if (!['overlap', 'after-reveal', 'first'].includes(fold)) throw new Error(`Unknown fold: ${fold}`)

type AnswerTiming = {
  turnId: string
  reply: string
  firstCharacters?: number
  foldStart?: number
  foldEnd?: number
  revealEnd?: number
}

type ElementState = {
  id: string
  label: string
  top: number
  height: number
  visible: boolean
  text: string
  state: string
  textState: boolean
  node: number
  painted: boolean
  ink: boolean
  streaming: boolean
  textAnimating: boolean
  counter: boolean
  rolling: boolean
  rollingNow: boolean
  rollingFrom: string | null
  batchLabel: boolean
}
type SwapFrame = {
  from: string
  to: string
  width: number
  oldWidth: number
  newWidth: number
  outgoing: number
  incoming: number
  blur: string
  transform: string
  animations: { property: string; ms: number | null; duration: number | string; easing: string }[]
}
type WorkRowState = { id: string; label: string; top: number; live: boolean; running: string[] }
type ReplayState = { ms: number; running: { id: string; label: string; counted: string }[] }
type Snapshot = {
  replayMs: number
  workRows: WorkRowState[]
  liveRows: number
  swaps: SwapFrame[]
  slots: {
    id: string
    now: { label: string; top: number } | null
    rows: { node: number; label: string; top: number; visible: boolean }[]
  }[]
  height: number
  elements: ElementState[]
  shifts: unknown[]
  timings: AnswerTiming[]
  discrete: string[]
  queue: { maxWait: number; example?: unknown }
}
type Finding = {
  transcript: string
  ms: number
  frame: number
  endFrame: number
  element: string
  id: string
  kind:
    | 'shift'
    | 'height-dip'
    | 'flash'
    | 'remount'
    | 'text-retraction'
    | 'overlap'
    | 'empty-hand-off'
    | 'stale-live-row'
    | 'live-row-overlap'
  property: string
  before: unknown
  during: unknown
  after: unknown
  images: string[]
}
type ScanWindow = typeof window & {
  __feelClock: { step: <T>(sample: () => T) => Promise<T>; now: () => number }
  __feelSample: () => Snapshot
  __feelReplay: () => ReplayState
}

// Runs in the browser. Offsets exclude CSS transforms, including rolling text and scroll glides.
function installSampler(answers: AnswerTiming[]) {
  const pane = document.querySelector('[data-chat-feel="hybrid"]')!
  const content = pane.querySelector('[aria-label="Conversation"] > div') as HTMLElement
  const scroller = content.parentElement!
  const shifts: unknown[] = []
  const nodes = new WeakMap<Element, number>()
  let serial = 0
  const previousMotion = new WeakMap<Element, string>()
  const outgoing = '[aria-hidden="true"].rolling-text-out, [aria-hidden="true"].absolute'

  function textOf(element: Element): string {
    if (element.matches(outgoing) || element.matches('[data-slot="tool-status-active"]')) return ''
    if (
      element.matches('[data-component="tool-status-title"]') &&
      element.hasAttribute('aria-label')
    )
      return element.getAttribute('aria-label')!
    if (element.hasAttribute('torph-root')) {
      const accessible = element.querySelector('[torph-sr]')
      if (accessible) {
        const stray = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join('')
        return accessible.textContent + stray
      }
    }
    return [...element.childNodes]
      .map((node) => (node instanceof Element ? textOf(node) : (node.textContent ?? '')))
      .join('')
  }

  function animating(element: Element) {
    return element.getAnimations({ subtree: true }).some((animation) => {
      const timing = animation.effect?.getComputedTiming()
      return timing && timing.progress !== null && timing.progress < 1 && timing.iterations === 1
    })
  }
  function recordShifts(entries: PerformanceEntry[]) {
    for (const raw of entries) {
      const entry = raw as PerformanceEntry & {
        value: number
        hadRecentInput: boolean
        sources: {
          node: Element | null
          previousRect: DOMRectReadOnly
          currentRect: DOMRectReadOnly
        }[]
      }
      const sources = entry.sources.filter((source) => source.node && pane.contains(source.node))
      if (!sources.length) continue
      shifts.push({
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
        sources: sources.map((source) => ({
          text: source.node?.textContent?.slice(0, 100),
          before: { top: source.previousRect.y, height: source.previousRect.height },
          after: { top: source.currentRect.y, height: source.currentRect.height },
        })),
      })
    }
  }
  const observer = new PerformanceObserver((list) => recordShifts(list.getEntries()))
  observer.observe({ type: 'layout-shift' })

  function identity(element: HTMLElement) {
    const path = []
    let node: HTMLElement | null = element
    while (node && node !== content) {
      if (node.hasAttribute('data-index')) {
        path.unshift(`row[${node.dataset.index}]`)
        break
      }
      const siblings = node.parentElement ? [...node.parentElement.children] : []
      path.unshift(
        node.id
          ? `${node.localName}[${node.id}]`
          : `${node.localName}:${siblings.filter((sibling) => sibling.localName === node!.localName && !sibling.matches(outgoing)).indexOf(node)}`
      )
      node = node.parentElement
    }
    return path.join('/')
  }

  function layoutTop(element: HTMLElement) {
    let transform = 0
    let scroll = 0
    for (
      let node: HTMLElement | null = element;
      node && node !== content;
      node = node.parentElement
    ) {
      const css = getComputedStyle(node)
      if (css.transform !== 'none') transform += new DOMMatrixReadOnly(css.transform).m42
      if (node !== element) scroll += node.scrollTop
    }
    return Number(
      (
        element.getBoundingClientRect().top -
        content.getBoundingClientRect().top -
        transform +
        scroll
      ).toFixed(3)
    )
  }

  function sample(): Snapshot {
    recordShifts(observer.takeRecords())
    const elements: ElementState[] = []
    const clip = scroller.getBoundingClientRect()
    for (const element of content.querySelectorAll<HTMLElement>('*')) {
      if (element.closest(`svg, [torph-item], [torph-sr], ${outgoing}`)) continue
      const title = element.closest('[data-component="tool-status-title"]')
      if (title && title !== element) continue
      const directText =
        (title === element && !!textOf(element).trim()) ||
        [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
        )
      const semantic = element.matches(
        '[data-chat-row], [data-work-heading], [data-slot="bubble-content"], .activity-header, .hybrid-now, [class*="rolling-text"], h1,h2,h3,h4,p,li,pre,button,a,label,span'
      )
      if (!directText && !semantic) continue
      let opacity = 1
      let shown = true
      for (
        let node: HTMLElement | null = element;
        node && node !== scroller;
        node = node.parentElement
      ) {
        const css = getComputedStyle(node)
        opacity *= Number(css.opacity)
        if (css.display === 'none' || css.visibility !== 'visible' || node.hidden) shown = false
        const rect = node.getBoundingClientRect()
        if (css.overflowY === 'hidden' || css.overflowY === 'clip') {
          const own = element.getBoundingClientRect()
          if (own.bottom <= rect.top || own.top >= rect.bottom) shown = false
        }
      }
      const rect = element.getBoundingClientRect()
      const attrs = [...element.attributes]
        .filter(
          (attr) =>
            /^(data-|aria-|role$)/.test(attr.name) &&
            !['data-chat-new', 'data-discrete-running'].includes(attr.name)
        )
        .map((attr) => `${attr.name}=${attr.value}`)
        .join(' ')
      const classes = [...element.classList]
        .filter((name) => /shimmer|tense|rolling|hybrid-now|activity-header/.test(name))
        .join(' ')
      const text = textOf(element).replace(/\s+/g, ' ').trim()
      const painted = shown && opacity > 0.01 && rect.width > 0 && rect.height > 0
      if (!nodes.has(element)) nodes.set(element, serial++)
      const morphs = [...element.querySelectorAll('[torph-root]')]
      const root = element.closest('[torph-root]')
      if (root) morphs.push(root)
      const rolling = element.closest('.rolling-text-window')
      elements.push({
        id: identity(element),
        label: `${element.localName} ${attrs} ${classes} ${text.slice(0, 100)}`.trim(),
        top: layoutTop(element),
        height: Number(rect.height.toFixed(3)),
        visible: painted && rect.bottom > clip.top && rect.top < clip.bottom,
        painted,
        ink: directText && painted && text.length > 0,
        node: nodes.get(element)!,
        streaming: !!element.closest('[data-quote]'),
        batchLabel: !!element.closest('[data-batch-tense]'),
        rollingFrom: element.querySelector(':scope > .rolling-text-out')?.textContent ?? null,
        rolling: element.matches('.rolling-text-window'),
        rollingNow: [...element.children].some(
          (child) =>
            animating(child) &&
            (child.matches('.rolling-text-in') ||
              child
                .getAnimations()
                .some(
                  (animation) =>
                    animation instanceof CSSAnimation &&
                    animation.animationName === 'rolling-text-fade-in'
                ))
        ),
        counter: !!(element.closest('.font-mono') || element.querySelector('.font-mono')),
        textAnimating:
          morphs.some(animating) ||
          !!(title && animating(title)) ||
          !!(rolling && animating(rolling)) ||
          !!(
            element.closest('[data-handoff-running]') &&
            animating(element.closest('[data-handoff-running]')!)
          ),
        text,
        state: `${attrs} ${classes}`.trim(),
        textState:
          directText ||
          element.matches('p,li,pre,[data-work-heading],.hybrid-now,.rolling-text-window'),
      })
    }
    for (const element of elements) {
      if (!/data-chat-row=assistant|data-slot=bubble-content|hybrid-now/.test(element.label))
        continue
      if (elements.some((child) => child.ink && child.id.startsWith(`${element.id}/`))) continue
      element.painted = element.visible = false
    }
    const now = Number((window as ScanWindow).__feelClock.now().toFixed(1))
    for (const answer of answers) {
      const work = content.querySelector(`[data-work-turn="${answer.turnId}"]`)
      const disclosure = work?.querySelector('[data-flush-work]')
      const body = disclosure?.querySelector<HTMLElement>(':scope > [aria-hidden]')
      if (body?.getAttribute('aria-hidden') === 'true') {
        answer.foldStart ??= now
        if (body.getBoundingClientRect().height === 0) answer.foldEnd ??= now
      }
      const bubble = content.querySelector(`[data-quote="${answer.reply}"]`)
      if (!bubble?.textContent?.trim()) continue
      const painted = elements.some(
        (element) =>
          element.visible &&
          element.ink &&
          element.id.startsWith(`${identity(bubble as HTMLElement)}/`)
      )
      if (painted) answer.firstCharacters ??= now
      if (!bubble.querySelector('.markdown-streaming') && !animating(bubble))
        answer.revealEnd ??= now
    }
    const discrete = new Set<string>()
    for (const animation of pane.getAnimations({ subtree: true })) {
      const effect = animation.effect as KeyframeEffect | null
      const timing = effect?.getComputedTiming()
      const element = effect?.target
      if (
        !(element instanceof HTMLElement) ||
        !timing ||
        timing.iterations !== 1 ||
        timing.progress === null ||
        timing.progress >= 1
      )
        continue
      const name = animation instanceof CSSAnimation ? animation.animationName : ''
      const property = animation instanceof CSSTransition ? animation.transitionProperty : ''
      if (
        animation instanceof CSSTransition &&
        element.matches(
          '[data-slot="tool-status-active"], [data-slot="tool-status-done"], [data-slot="tool-status-swap"]'
        )
      ) {
        discrete.add(
          identity(element.closest<HTMLElement>('[data-component="tool-status-title"]')!)
        )
      } else if (name.startsWith('rolling-text-')) {
        const handoffLabel = element.matches(
          '.hybrid-handoff-row .activity-header > :first-child, .hybrid-handoff > [aria-hidden] > .rolling-text-out'
        )
        const owner = handoffLabel
          ? element.closest<HTMLElement>('[data-now-handoff]')
          : element.closest<HTMLElement>('.rolling-text-window')
        if (owner) discrete.add(identity(owner))
      } else if (
        property === 'color' &&
        element.matches('[data-interim-text], [data-interim-answer]')
      ) {
        discrete.add(identity(element))
      }
    }
    for (const element of content.querySelectorAll<HTMLElement>('.overflow-hidden[style]')) {
      if (!element.style.height || !element.style.opacity) continue
      const stamp = element.style.height + ':' + element.style.opacity
      const previous = previousMotion.get(element)
      previousMotion.set(element, stamp)
      if (
        element.dataset.discreteRunning === 'true' ||
        (!element.hasAttribute('data-discrete-running') &&
          previous !== undefined &&
          previous !== stamp &&
          element.style.height !== 'auto')
      )
        discrete.add(identity(element))
    }
    const queue = (
      pane.querySelector('[data-chat-thread]') as HTMLElement & {
        feelQueue?: { maxWait: number; example?: unknown }
      }
    )?.feelQueue ?? { maxWait: 0 }
    const slots = [...content.querySelectorAll<HTMLElement>('[data-work-turn]')]
      .filter((list) => !list.parentElement?.closest('[data-work-turn]'))
      .map((list) => {
        function headerState(row: Element) {
          const header = row.querySelector<HTMLElement>('.activity-header')
          if (!header) return null
          const id = identity(header)
          const visible = elements.some(
            (element) => element.ink && element.visible && element.id.startsWith(`${id}/`)
          )
          return {
            node: nodes.get(header)!,
            label: textOf(header).trim(),
            top: layoutTop(header),
            visible,
          }
        }
        const nowRow = list.querySelector('.hybrid-now')
        let now = nowRow && headerState(nowRow)
        if (!now?.visible) {
          for (const handoff of list.querySelectorAll<HTMLElement>('[data-now-handoff]')) {
            const outgoing = handoff.querySelector<HTMLElement>(':scope > [aria-hidden] > span')
            if (!outgoing) continue
            const rect = outgoing.getBoundingClientRect()
            if (
              Number(getComputedStyle(outgoing).opacity) <= 0.01 ||
              rect.height === 0 ||
              getComputedStyle(outgoing.parentElement!).display === 'none' ||
              rect.bottom <= clip.top ||
              rect.top >= clip.bottom
            )
              continue
            const header = outgoing.parentElement!
            now = {
              node: nodes.get(header) ?? -1,
              label: outgoing.textContent!.trim(),
              top: layoutTop(header),
              visible: true,
            }
            break
          }
        }
        const rows = [...list.querySelectorAll('.work-scroll > div > div')]
          .filter((row) => !row.classList.contains('hybrid-now'))
          .flatMap((row) => {
            const header = headerState(row)
            return header ? [header] : []
          })
        return { id: identity(list), now: now?.visible ? now : null, rows }
      })
    // Contract (Today and v2): chronological .activity-header work rows under [data-work-turn],
    // visible ink + .shimmer/present-tense labels; __feelReplay supplies event-open IDs/labels and ms.
    // Labels must identify the work (or a counted batch); parallel rows require distinct open IDs.
    const replay = (window as ScanWindow).__feelReplay()
    const workRows = [...content.querySelectorAll<HTMLElement>('[data-work-turn] .activity-header')]
      .filter((header) => {
        const id = identity(header)
        return (
          !header.matches('[data-flush]') &&
          elements.some(
            (element) =>
              element.ink &&
              element.visible &&
              (element.id === id || element.id.startsWith(`${id}/`))
          )
        )
      })
      .map((header) => {
        const label = textOf(header).replace(/\s+/g, ' ').trim()
        const id = identity(header)
        const shimmer = [header, ...header.querySelectorAll<HTMLElement>('.shimmer')].some(
          (node) => {
            if (!node.classList.contains('shimmer')) return false
            const owner = identity(node)
            return elements.some(
              (element) =>
                element.ink &&
                element.visible &&
                (element.id === owner || element.id.startsWith(`${owner}/`))
            )
          }
        )
        return {
          id,
          label,
          top: layoutTop(header),
          live:
            shimmer ||
            /^(Thinking|Reading|Editing|Writing|Searching|Running|Calling|Planning|Archiving|Messaging|Marking|Linking|Sharing|Creating|Updating|Fetching|Listing|Switching|Setting)\b/.test(
              label
            ),
          running: replay.running
            .filter((item) => {
              const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
              return item.label === 'Thinking'
                ? /^Thinking\b/.test(label)
                : normalize(item.label) === label ||
                    normalize(item.counted) === label.replace(/\b\d+\b/, '{count}')
            })
            .map((item) => item.id),
        }
      })
    return {
      replayMs: replay.ms,
      workRows,
      liveRows: workRows.filter((row) => row.live).length,
      swaps: [
        ...content.querySelectorAll<HTMLElement>('[data-component="tool-status-title"]'),
      ].flatMap((title) => {
        const old = title.querySelector<HTMLElement>('[data-slot="tool-status-active"]')
        const next = title.querySelector<HTMLElement>('[data-slot="tool-status-done"]')
        const slot = title.querySelector<HTMLElement>('[data-slot="tool-status-swap"]')
        if (!old || !next || !slot) return []
        return [
          {
            from:
              (title.querySelector('[data-slot="tool-status-prefix"]')?.textContent ?? '') +
              old.textContent,
            to: title.getAttribute('aria-label') ?? '',
            width: slot.getBoundingClientRect().width,
            oldWidth: Math.ceil(old.getBoundingClientRect().width),
            newWidth: Math.ceil(next.getBoundingClientRect().width),
            outgoing: Number(getComputedStyle(old).opacity),
            incoming: Number(getComputedStyle(next).opacity),
            blur: getComputedStyle(old).filter,
            transform: getComputedStyle(old).transform,
            animations: title
              .getAnimations({ subtree: true })
              .filter((animation) => animation instanceof CSSTransition)
              .map((animation) => ({
                property: (animation as CSSTransition).transitionProperty,
                ms: typeof animation.currentTime === 'number' ? animation.currentTime : null,
                duration: animation.effect!.getTiming().duration,
                easing: animation.effect!.getTiming().easing,
              })),
          },
        ]
      }),
      slots,
      discrete: [...discrete],
      queue: { ...queue },
      height: content.offsetHeight,
      elements,
      shifts: shifts.splice(0),
      timings: answers.map((answer) => ({ ...answer })),
    }
  }
  ;(window as ScanWindow).__feelSample = sample
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function detect(transcript: string, frames: Snapshot[]): Finding[] {
  const findings: Finding[] = []
  const maps = frames.map(
    (frame) => new Map(frame.elements.map((element) => [element.id, element]))
  )
  function add(
    frame: number,
    endFrame: number,
    element: string,
    kind: Finding['kind'],
    property: string,
    before: unknown,
    during: unknown,
    after: unknown,
    id = 'content'
  ) {
    findings.push({
      transcript,
      ms:
        kind === 'stale-live-row' || kind === 'live-row-overlap'
          ? frames[frame]!.replayMs
          : Number((frame * frameMs).toFixed(1)),
      frame,
      endFrame,
      element,
      id,
      kind,
      property,
      before,
      during,
      after,
      images: [frame - 1, frame, endFrame + 1].map((at) => `frames/${transcript}-${at}.png`),
    })
  }
  const semantic = new Map<string, Finding>()
  for (let index = 0; index < frames.length; index++) {
    const snapshot = frames[index]!
    function flag(key: string, row: string, kind: Finding['kind'], during: unknown) {
      const previous = semantic.get(key)
      if (previous?.endFrame === index - 1) {
        previous.endFrame = index
        previous.images[2] = `frames/${transcript}-${index + 1}.png`
      } else {
        add(index, index, row, kind, 'live rows', null, during, null, key)
        semantic.set(key, findings.at(-1)!)
      }
    }
    for (const [position, row] of snapshot.workRows.entries()) {
      if (!row.live) continue
      for (const newer of snapshot.workRows.slice(position + 1)) {
        if (newer.top <= row.top) continue
        if (row.running.some((id) => newer.running.some((other) => other !== id))) continue
        flag(`${row.id} -> ${newer.id}`, row.label, 'stale-live-row', {
          live: row.label,
          newer: newer.label,
          running: row.running,
          newerRunning: newer.running,
        })
      }
    }
    const live = snapshot.workRows.filter((row) => row.live)
    function parallel(position: number, used: Set<string>): boolean {
      if (position === live.length) return true
      return live[position]!.running.some(
        (id) => !used.has(id) && parallel(position + 1, new Set([...used, id]))
      )
    }
    if (live.length > 1 && !parallel(0, new Set()))
      flag('live rows', live.map((row) => row.label).join(' + '), 'live-row-overlap', {
        count: live.length,
        rows: live,
      })
  }
  for (let index = 0; index < frames.length; index++) {
    const running = frames[index]!.discrete
    if (running.length > 1 && (index === 0 || frames[index - 1]!.discrete.length <= 1))
      add(index, index, 'discrete transitions', 'overlap', 'running', 1, running, 1)
  }
  for (let index = 1; index < frames.length; index++) {
    for (const slot of frames[index - 1]!.slots) {
      if (!slot.now) continue
      const next = frames[index]!.slots.find((entry) => entry.id === slot.id)
      if (!next || next.now) continue
      const arrived = next.rows.filter(
        (row) => !slot.rows.some((before) => before.node === row.node)
      )
      if (!arrived.length) continue
      let end = index
      while (end < frames.length) {
        const current = frames[end]!.slots.find((entry) => entry.id === slot.id)
        if (
          !current ||
          current.now ||
          current.rows.some(
            (row) =>
              row.visible &&
              arrived.some((arrival) => arrival.node === row.node) &&
              Math.abs(row.top - slot.now!.top) < 3
          )
        )
          break
        end++
      }
      if (end > index)
        add(
          index,
          end - 1,
          slot.now.label,
          'empty-hand-off',
          'slot',
          slot.now,
          end - index,
          arrived,
          slot.id
        )
    }
  }
  // Consecutive movement belongs to a grow-in; only isolated nudges are candidates.
  for (let index = 1; index < frames.length - 3; index++) {
    for (const [id, element] of maps[index]!) {
      const before = maps[index - 1]!.get(id)
      if (!before || !element.visible || !before.visible) continue
      if (element.node !== before.node && !element.textAnimating)
        add(
          index,
          index,
          element.label,
          'remount',
          'node',
          before.node,
          element.node,
          element.node,
          id
        )
      if (
        element.streaming &&
        before.textState &&
        element.textState &&
        before.text.startsWith(element.text) &&
        before.text.length > element.text.length &&
        !element.textAnimating
      )
        add(
          index,
          index,
          element.label,
          'text-retraction',
          'text',
          before.text,
          element.text,
          maps[index + 1]?.get(id)?.text,
          id
        )
      for (const property of ['top', 'height'] as const) {
        const delta = element[property] - before[property]
        if (Math.abs(delta) < 0.5 || Math.abs(delta) > 3) continue
        const prior = maps[index - 2]?.get(id)
        const next = maps[index + 1]!.get(id)
        if (!next) continue
        const wasMoving = prior && Math.abs(before[property] - prior[property]) >= 0.5
        const keepsMoving =
          Math.abs(next[property] - element[property]) >= 0.5 &&
          Math.sign(next[property] - element[property]) === Math.sign(delta)
        if (wasMoving || keepsMoving) continue
        const recovered = [1, 2, 3].find(
          (distance) => maps[index + distance]?.get(id)?.[property] === before[property]
        )
        add(
          index,
          index + (recovered ? recovered - 1 : 0),
          element.label,
          'shift',
          property,
          before[property],
          element[property],
          maps[index + (recovered ?? 1)]?.get(id)?.[property],
          id
        )
      }
    }
    const before = frames[index - 1]!.height
    const during = frames[index]!.height
    if (during >= before - 0.5) continue
    const recovery = [1, 2, 3, 4, 5, 6, 7, 8].find(
      (distance) => frames[index + distance] && frames[index + distance]!.height >= before - 0.5
    )
    // Fold first deliberately shrinks, then grows. Recovery during the fold is still a fault.
    const sequentialFold =
      recovery &&
      fold === 'first' &&
      frames
        .at(-1)!
        .timings.some(
          (answer) =>
            answer.foldStart !== undefined &&
            answer.foldEnd !== undefined &&
            answer.revealEnd !== undefined &&
            index * frameMs >= answer.foldStart &&
            index * frameMs <= answer.foldEnd &&
            (index + recovery) * frameMs >= answer.foldEnd &&
            (index + recovery) * frameMs <= answer.revealEnd
        )
    if (recovery && !sequentialFold)
      add(
        index,
        index + recovery - 1,
        'thread content',
        'height-dip',
        'height',
        before,
        during,
        frames[index + recovery]!.height
      )
  }
  const ids = new Set(maps.flatMap((map) => [...map.keys()]))
  for (const id of ids) {
    for (const property of ['exists', 'visible', 'text', 'state'] as const) {
      function value(index: number) {
        const element = maps[index]?.get(id)
        if (property === 'exists') return !!element
        if (property === 'text' && !element?.textState) return null
        if (property === 'visible') return element?.painted ?? null
        return element?.[property] ?? null
      }
      let start = 0
      let current = value(0)
      for (let index = 1; index < frames.length; index++) {
        const next = value(index)
        if (next === current) continue
        if (start > 0 && index - start <= 2) {
          const element = maps[start]!.get(id) ?? maps[start - 1]!.get(id)
          const visible = [start - 1, start, index].some((at) => maps[at]?.get(id)?.visible)
          const before = value(start - 1)
          const fadeIn =
            property === 'visible' && before === null && current === false && next === true
          const growth =
            property === 'text' &&
            element?.streaming &&
            typeof current === 'string' &&
            ((typeof before === 'string' &&
              current.startsWith(before) &&
              (next === null || (typeof next === 'string' && next.startsWith(current)))) ||
              (before === null && typeof next === 'string' && next.startsWith(current)))
          const countGrowth =
            property === 'text' &&
            element?.counter &&
            typeof current === 'string' &&
            /^[\d,.]+$/.test(current) &&
            ((typeof next === 'string' &&
              /^[\d,.]+$/.test(next) &&
              Number(next.replaceAll(',', '')) >= Number(current.replaceAll(',', ''))) ||
              (next === null && typeof before === 'string' && /^[\d,.]+$/.test(before))) &&
            (before === null ||
              before === '' ||
              (typeof before === 'string' &&
                /^[\d,.]+$/.test(before) &&
                Number(current.replaceAll(',', '')) >= Number(before.replaceAll(',', ''))))
          const counterLabelGrowth =
            property === 'text' &&
            element?.counter &&
            typeof current === 'string' &&
            /\d/.test(current) &&
            [before, next].some(
              (value) =>
                typeof value === 'string' &&
                value.replace(/[\d,.]+/g, '#') === current.replace(/[\d,.]+/g, '#')
            )
          const textAnimation =
            (property === 'text' || property === 'visible') &&
            [start - 1, start, index].some((at) => maps[at]?.get(id)?.textAnimating)
          const foldingDisclosure =
            fold === 'after-reveal' &&
            property === 'state' &&
            before === null &&
            element?.label.includes('activity-header Worked') &&
            typeof current === 'string' &&
            current.includes('aria-expanded=true') &&
            next === current.replace('aria-expanded=true', 'aria-expanded=false')
          const completedLink =
            property === 'state' &&
            before === null &&
            typeof current === 'string' &&
            current.includes('data-incomplete=true') &&
            next === current.replace('data-incomplete=true', 'data-incomplete=false')
          if (
            visible &&
            current !== null &&
            !fadeIn &&
            !growth &&
            !countGrowth &&
            !counterLabelGrowth &&
            !textAnimation &&
            !foldingDisclosure &&
            !completedLink
          )
            add(
              start,
              index - 1,
              element!.label,
              'flash',
              property,
              value(start - 1),
              current,
              next,
              id
            )
        }
        start = index
        current = next
      }
    }
  }
  return findings.sort(
    (a, b) =>
      a.frame - b.frame ||
      a.element.localeCompare(b.element) ||
      a.kind.localeCompare(b.kind) ||
      a.property.localeCompare(b.property)
  )
}

function shortestVisible(frames: Snapshot[]) {
  const labels = new Map<
    string,
    { text: string; since: number; stable: boolean; painted: boolean }
  >()
  let shortest: { ms: number; frames: number; frame: number; label: string; id: string } | null =
    null
  for (let frame = 0; frame < frames.length; frame++) {
    const present = new Set<string>()
    for (const element of frames[frame]!.elements) {
      if (!element.rolling || !element.batchLabel) continue
      present.add(element.id)
      const before = labels.get(element.id)
      const arrivingRoll =
        element.painted && element.rollingNow && !before?.painted && element.rollingFrom !== null
      if (
        element.painted &&
        element.rollingNow &&
        ((before?.stable && element.text !== before.text) || arrivingRoll)
      ) {
        // A roll already underway at first paint gives only a one-frame upper bound.
        const duration = arrivingRoll ? 1 : Math.max(1, frame - before!.since)
        if (!shortest || duration < shortest.frames)
          shortest = {
            ms: Number((duration * frameMs).toFixed(1)),
            frames: duration,
            frame,
            label: arrivingRoll ? element.rollingFrom! : before!.text,
            id: element.id,
          }
      }
      if (!element.painted || element.rollingNow) {
        labels.set(element.id, {
          text: element.text,
          since: frame,
          stable: false,
          painted: element.painted,
        })
      } else if (!before?.stable || before.text !== element.text) {
        labels.set(element.id, {
          text: element.text,
          since: frame,
          stable: true,
          painted: element.painted,
        })
      }
    }
    for (const id of labels.keys()) if (!present.has(id)) labels.delete(id)
  }
  return shortest
}

function freePort() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port!
  server.stop(true)
  return [5173, 5174, 8787, 5200, 8820].includes(port) ? freePort() : port
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function prepare(page: Page, url: string, transcript: string, answers: AnswerTiming[]) {
  await page.goto(
    `${url}/dev/feels?scan=${transcript}&fold=${fold}&batchLabel=${batchLabel}&tenseChange=${tenseChange}&rows=${rows}&engine=${encodeURIComponent(engine)}&perf=off`
  )
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((font) => font.load()))
    await document.fonts.ready
  })
  await page.waitForFunction(
    () => !!(window as ScanWindow).__feelClock && !!(window as ScanWindow).__feelReplay,
    undefined,
    {
      polling: 100,
    }
  )
  await page.evaluate(installSampler, answers)
}

async function advance(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const scan = window as ScanWindow
    return scan.__feelClock.step(scan.__feelSample)
  })
}

async function crop(cdp: CDPSession, page: Page, path: string) {
  const box = await page.locator('[data-chat-feel="hybrid"]').boundingBox()
  if (!box) throw new Error('Pane D is missing')
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...box, scale: 1 },
    captureBeyondViewport: false,
  })
  await Bun.write(path, Buffer.from(shot.data, 'base64'))
}

async function main() {
  const output = resolve(process.argv[2] ?? (await mkdtemp(join(tmpdir(), 'feel-scan-'))))
  if (output === root || output.startsWith(`${root}/`))
    throw new Error('Scan output must be outside the repo')
  await mkdir(join(output, 'frames'), { recursive: true })
  const scratch = await mkdtemp(join(tmpdir(), 'feel-scan-runtime-'))
  const serverPort = freePort()
  const clientPort = freePort()
  const env = {
    ...process.env,
    JETTY_AGENT: 'echo',
    JETTY_HOME: join(scratch, 'home'),
    PORT: String(serverPort),
    JETTY_SERVER_PORT: String(serverPort),
    JETTY_CLIENT_PORT: String(clientPort),
  }
  const processes: ReturnType<typeof Bun.spawn>[] = []
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    for (const [name, command] of [
      ['server', ['bun', 'server/src/main.ts']],
      ['client', ['bun', join(root, 'client/node_modules/vite/bin/vite.js')]],
    ] as const) {
      processes.push(
        Bun.spawn([...command], {
          cwd: name === 'client' ? join(root, 'client') : root,
          env,
          stdout: Bun.file(join(scratch, `${name}.log`)),
          stderr: 'inherit',
        })
      )
    }
    const url = `http://localhost:${clientPort}`
    await Promise.all([waitFor(`http://localhost:${serverPort}`), waitFor(url)])
    const cache = join(homedir(), 'Library/Caches/ms-playwright')
    const shells = [
      ...new Bun.Glob(
        'chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell'
      ).scanSync({ cwd: cache }),
    ].sort()
    const shell = shells.at(-1)
    if (!shell)
      throw new Error(
        'Install Playwright chrome-headless-shell first: bunx playwright-core install chromium-headless-shell'
      )
    const profile = join(scratch, 'chrome')
    processes.push(
      Bun.spawn(
        [
          join(cache, shell),
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
          '--use-mock-keychain',
          '--password-store=basic',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          `--window-size=${viewport.width},${viewport.height}`,
          'about:blank',
        ],
        { stdout: 'ignore', stderr: Bun.file(join(scratch, 'chrome.log')) }
      )
    )
    let port = ''
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]!
        break
      } catch {
        await Bun.sleep(100)
      }
    }
    browser = await chromium.connectOverCDP(`http://localhost:${port}`)
    const context = browser.contexts()[0]!
    const page = context.pages()[0]!
    page.on('pageerror', (error) => console.error(error))
    await page.setViewportSize(viewport)
    if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' })
    const cdp = await context.newCDPSession(page)
    const opencodeSwaps: {
      transcript: string
      frames: { frame: number; ms: number; swap: SwapFrame }[]
    }[] = []
    const findings: Finding[] = []
    const handoffs: { transcript: string; frame: number; from: string; to: string }[] = []
    const concurrency: {
      transcript: string
      maxConcurrent: number
      exampleFrame: number
      ms: number
      running: string[]
      queue: Snapshot['queue']
    }[] = []
    const semantics: {
      transcript: string
      violationFrames: number
      rowPairFrames: number
      overlapFrames: number
      maxLiveRows: number
      liveRowCounts: Record<number, number>
    }[] = []
    const timings: { transcript: string; answers: AnswerTiming[] }[] = []
    const crossChecks: { transcript: string; frame: number; entries: unknown[] }[] = []
    const rollingLabels: {
      transcript: string
      mode: string
      shortest: ReturnType<typeof shortestVisible>
    }[] = []
    for (const transcript of transcripts) {
      const replay = await Bun.file(join(root, `client/src/dev/replays/${transcript}.json`)).json()
      const replies = new Map<string, string>()
      const answers: AnswerTiming[] = []
      for (const { event } of replay.events) {
        if (event.type === 'item.started' && event.item.kind === 'assistant_message')
          replies.set(event.item.turnId, event.item.id)
        if (event.type === 'turn.completed' && replies.has(event.turnId))
          answers.push({ turnId: event.turnId, reply: replies.get(event.turnId)! })
      }
      const count = Math.ceil((replay.events.at(-1).t + 2000) / frameMs)
      await prepare(page, url, transcript, answers)
      const frames: Snapshot[] = [await page.evaluate(() => (window as ScanWindow).__feelSample())]
      const hashes = [digest(frames[0])]
      const gzip = createGzip()
      const disk = createWriteStream(join(output, `${transcript}.frames.jsonl.gz`))
      gzip.pipe(disk)
      gzip.write(`${JSON.stringify({ frame: 0, ms: 0, ...frames[0] })}\n`)
      for (let index = 1; index <= count; index++) {
        const snapshot = await advance(page)
        hashes.push(digest({ ...snapshot, shifts: [] }))
        if (snapshot.shifts.length)
          crossChecks.push({ transcript, frame: index, entries: snapshot.shifts })
        frames.push(snapshot)
        gzip.write(
          `${JSON.stringify({ frame: index, ms: Number((index * frameMs).toFixed(1)), ...snapshot })}\n`
        )
        if (index % 1000 === 0) console.log(`${transcript}: measured ${index}/${count}`)
      }
      gzip.end()
      await new Promise<void>((resolve, reject) => {
        disk.on('finish', resolve)
        disk.on('error', reject)
      })
      const swapStart = frames.findIndex((snapshot) =>
        snapshot.swaps.some(
          (swap) => swap.from.startsWith('Thinking') && swap.to.startsWith('Thought')
        )
      )
      if (swapStart >= 0)
        opencodeSwaps.push({
          transcript,
          frames: frames.slice(swapStart, swapStart + 38).flatMap((snapshot, offset) => {
            const swap = snapshot.swaps.find(
              (swap) => swap.from.startsWith('Thinking') && swap.to.startsWith('Thought')
            )
            return swap
              ? [{ frame: swapStart + offset, ms: Number((offset * frameMs).toFixed(1)), swap }]
              : []
          }),
        })
      timings.push({ transcript, answers: frames.at(-1)!.timings })
      const maxConcurrent = Math.max(...frames.map((frame) => frame.discrete.length))
      const exampleFrame = frames.findIndex((frame) => frame.discrete.length === maxConcurrent)
      concurrency.push({
        transcript,
        maxConcurrent,
        exampleFrame,
        ms: exampleFrame * frameMs,
        running: frames[exampleFrame]!.discrete,
        queue: frames.at(-1)!.queue,
      })
      for (let index = 1; index < frames.length; index++) {
        for (const slot of frames[index - 1]!.slots) {
          if (!slot.now) continue
          const next = frames[index]!.slots.find((entry) => entry.id === slot.id)
          const arrival = next?.rows.find(
            (row) =>
              !slot.rows.some((before) => before.node === row.node) &&
              Math.abs(row.top - slot.now!.top) < 3
          )
          if (arrival)
            handoffs.push({ transcript, frame: index, from: slot.now.label, to: arrival.label })
        }
      }
      rollingLabels.push({ transcript, mode: batchLabel, shortest: shortestVisible(frames) })
      console.log(JSON.stringify(rollingLabels.at(-1)))
      const detected = detect(transcript, frames)
      const stale = detected.filter((finding) => finding.kind === 'stale-live-row')
      semantics.push({
        transcript,
        violationFrames: new Set(
          stale.flatMap((finding) =>
            Array.from(
              { length: finding.endFrame - finding.frame + 1 },
              (_, offset) => finding.frame + offset
            )
          )
        ).size,
        rowPairFrames: stale.reduce(
          (total, finding) => total + finding.endFrame - finding.frame + 1,
          0
        ),
        overlapFrames: detected
          .filter((finding) => finding.kind === 'live-row-overlap')
          .reduce((total, finding) => total + finding.endFrame - finding.frame + 1, 0),
        maxLiveRows: Math.max(...frames.map((frame) => frame.liveRows)),
        liveRowCounts: frames.reduce<Record<number, number>>((counts, frame) => {
          counts[frame.liveRows] = (counts[frame.liveRows] ?? 0) + 1
          return counts
        }, {}),
      })
      console.log(JSON.stringify(semantics.at(-1)))
      console.log(JSON.stringify(concurrency.at(-1)))
      findings.push(...detected)
      console.log(
        `${transcript}: ${detected.filter((finding) => finding.kind === 'empty-hand-off').reduce((total, finding) => total + finding.endFrame - finding.frame + 1, 0)} empty hand-off frames`
      )
      console.log(`${transcript}: ${detected.length} findings; rerunning for crops`)
      const lagFrame = Math.round(
        ((frames.at(-1)!.queue.example as { started?: number } | undefined)?.started ?? 0) / frameMs
      )
      const targets = new Set(
        detected.flatMap((finding) => [finding.frame - 1, finding.frame, finding.endFrame + 1])
      )
      for (const handoff of handoffs.filter((entry) => entry.transcript === transcript)) {
        for (const offset of [-1, 0, 1, 8, 30]) targets.add(handoff.frame + offset)
      }
      targets.add(exampleFrame)
      if (Number.isFinite(lagFrame)) targets.add(lagFrame)
      await prepare(page, url, transcript, answers)
      for (let index = 0; index <= count; index++) {
        const snapshot =
          index === 0
            ? await page.evaluate(() => (window as ScanWindow).__feelSample())
            : await advance(page)
        if (digest({ ...snapshot, shifts: [] }) !== hashes[index]) {
          await Bun.write(
            join(output, 'divergence.json'),
            JSON.stringify({ frame: index, expected: frames[index], actual: snapshot }, null, 2)
          )
          throw new Error(`${transcript}: screenshot rerun diverged at frame ${index}`)
        }
        if (targets.has(index))
          await crop(cdp, page, join(output, `frames/${transcript}-${index}.png`))
        if (index > Math.max(...targets)) break
      }
      await Bun.write(join(output, `${transcript}.hashes.json`), JSON.stringify(hashes))
    }
    findings.sort(
      (a, b) =>
        a.ms - b.ms ||
        a.transcript.localeCompare(b.transcript) ||
        a.element.localeCompare(b.element) ||
        a.property.localeCompare(b.property)
    )
    const report = {
      engine,
      semantics,
      tenseChange,
      rows,
      reducedMotion,
      opencodeSwaps,
      batchLabel,
      rollingLabels,
      fold,
      concurrency,
      handoffs,
      emptyHandOffFrames: transcripts.map((transcript) => ({
        transcript,
        count: findings
          .filter(
            (finding) => finding.transcript === transcript && finding.kind === 'empty-hand-off'
          )
          .reduce((total, finding) => total + finding.endFrame - finding.frame + 1, 0),
      })),
      timings,
      frameMs,
      viewport,
      frameControl: 'time_warp fixed steps; native paint-boundary sampling',
      findings,
      layoutShifts: crossChecks,
    }
    await Bun.write(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    const summary = concurrency.map(({ transcript, maxConcurrent, queue, exampleFrame }) => {
      const lagFrame = Math.round(
        ((queue.example as { started?: number } | undefined)?.started ?? 0) / frameMs
      )
      return `| ${transcript} | ${maxConcurrent} | ${queue.maxWait.toFixed(1)}ms | [running](frames/${transcript}-${exampleFrame}.png) / [queue release](frames/${transcript}-${lagFrame}.png) |`
    })
    const lines = findings.map(
      (finding) =>
        `- ${finding.transcript} · ${finding.ms}ms · frame ${finding.frame} · ${finding.kind} ${finding.property} · ${finding.id} · ${finding.element.replace(/\|/g, '\\|')} · ${JSON.stringify(finding.before)} → ${JSON.stringify(finding.during)} → ${JSON.stringify(finding.after)} · ${finding.images.map((path, index) => `[${['before', 'during', 'after'][index]}](${path})`).join(' / ')}`
    )
    await Bun.write(
      join(output, 'report.md'),
      `# Pane D feel scan\n\n16.7ms fixed frames; 1440×900; ${fold} fold; ${batchLabel} batch labels; ${tenseChange} tense; ${rows} rows; other toggles default. Loose heuristics: findings require inspection. Raw per-frame DOM records and Chrome layout-shift cross-checks are included.\n\n| Transcript | Max concurrent | Max queue wait | Example frames |\n| --- | ---: | ---: | --- |\n${summary.join('\n')}\n\nShortest settled batch label before its next roll (16.7ms sampling; first-paint rolls are bounded by one frame):\n${rollingLabels.map(({ transcript, shortest }) => `- ${transcript}: ${shortest ? `${shortest.ms}ms (${shortest.frames} frames), ${shortest.label}` : 'no repeated roll'}`).join('\n')}\n\nSemantic live rows (violating frames / row-pair frames / invalid multiple-live frames / max live rows):\n${semantics.map((entry) => `- ${entry.transcript}: ${entry.violationFrames} / ${entry.rowPairFrames} / ${entry.overlapFrames} / ${entry.maxLiveRows}`).join('\n')}\n\n${lines.join('\n')}\n`
    )
    console.log(`Report: ${output}`)
  } finally {
    await browser?.close()
    for (const process of processes) process.kill()
    await Promise.all(processes.map((process) => process.exited))
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()
