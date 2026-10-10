import type { Page } from 'playwright-core'

import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

import { streamStates } from '../client/src/dev/stream_states'

const root = resolve(import.meta.dir, '..')
const viewport = { width: 1440, height: 1100 }
const frameMs = 16.7

type Piece = { text: string; opacity: number; lostSpaces: number }
type LabelFrame = {
  id: string
  label: boolean
  expected: string
  from: string | null
  to: string | null
  prefix: Piece
  old: Piece
  next: Piece
  suffix: Piece
  text: string
  emptyNumbers: number
  staticOpacity: number[]
  problems: string[]
}
type StateFrame = { frame: number; ms: number; rows: LabelFrame[] }
type StateWindow = typeof window & {
  __feelClock: { step: <T>(sample?: () => T) => Promise<T>; now: () => number }
  __stateSample: () => LabelFrame[]
}

// Measure painted text, preserving spaces. Torph's aria-hidden rails are the actual
// odometer ink; its screen-reader copy supplies the value only after checking that ink.
function installSampler(id: string) {
  const card = document.querySelector(`[data-state="${id}"]`)!
  function opacity(element: Element, includeHidden = false) {
    let value = 1
    for (let node: Element | null = element; node && node !== card; node = node.parentElement) {
      const css = getComputedStyle(node)
      if (
        css.display === 'none' ||
        css.visibility !== 'visible' ||
        (!includeHidden && node.getAttribute('aria-hidden') === 'true')
      )
        return 0
      value *= Number(css.opacity)
    }
    return value
  }
  function intersects(rect: DOMRect, clip: DOMRect) {
    return (
      rect.right > clip.left &&
      rect.left < clip.right &&
      rect.bottom > clip.top &&
      rect.top < clip.bottom
    )
  }
  const numbers = new WeakMap<Element, { value: string; previous: string }>()
  function ink(root: Element) {
    let emptyNumbers = 0
    let lostSpaces = 0
    function read(node: Node): string {
      if (node instanceof Element) {
        if (opacity(node) <= 0.01 || node.matches('svg, [torph-sr], .sr-only')) return ''
        if (node.hasAttribute('torph-root')) {
          const value = node.querySelector('[torph-sr]')?.textContent ?? ''
          const last = numbers.get(node)
          if (!last || last.value !== value)
            numbers.set(node, { value, previous: last?.value ?? value })
          const previous = numbers.get(node)!.previous
          const slots = [...node.querySelectorAll<HTMLElement>('[torph-kind="digit"]')]
          const current = slots.filter((slot) => !slot.hasAttribute('torph-exiting'))
          const clip = node.getBoundingClientRect()
          function painted(candidate: string) {
            return [...candidate].every((char, index) =>
              slots.some((slot) => {
                const digit = slot.firstElementChild
                if (!digit || digit.textContent !== char || opacity(digit, true) <= 0.01)
                  return false
                const rect = digit.getBoundingClientRect()
                const box = slot.getBoundingClientRect()
                const column = current[index]?.getBoundingClientRect()
                return (
                  intersects(rect, clip) &&
                  intersects(rect, box) &&
                  (!column || (box.left < column.right && box.right > column.left))
                )
              })
            )
          }
          if (painted(value)) return value
          if (painted(previous)) return previous
          emptyNumbers++
          return ''
        }
        return [...node.childNodes].map(read).join('')
      }
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent) return ''
      const parent = node.parentElement!
      if (opacity(parent) <= 0.01) return ''
      const value = node.textContent
      if (/^\d+$/.test(value)) {
        const range = document.createRange()
        range.selectNodeContents(node)
        const rect = range.getBoundingClientRect()
        for (
          let ancestor: Element | null = parent;
          ancestor && ancestor !== card;
          ancestor = ancestor.parentElement
        ) {
          const css = getComputedStyle(ancestor)
          if (
            /(hidden|clip|auto|scroll)/.test(css.overflowY) &&
            !intersects(rect, ancestor.getBoundingClientRect())
          ) {
            emptyNumbers++
            return ''
          }
        }
      }
      for (let index = 0; index < value.length; index++) {
        if (value[index] !== ' ') continue
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + 1)
        if (range.getBoundingClientRect().width < 0.1) lostSpaces++
      }
      return value
    }
    return { text: root ? read(root) : '', emptyNumbers, lostSpaces }
  }
  // Pixel faults DOM text can't show: a text clip blanks anything on its own layer
  // (rolling digits, fading swaps), a raised middle jumps the baseline, and an unclipped
  // middle paints over the suffix.
  function problems(row: Element, title: Element | null) {
    const found: string[] = []
    if (
      [row, ...row.querySelectorAll('*')].some(
        (element) => getComputedStyle(element).backgroundClip === 'text'
      )
    )
      found.push('text clip')
    if (!title) return found
    function glyphs(element: Element | null) {
      const rects: DOMRect[] = []
      if (!element) return rects
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement!
        if (!node.textContent?.trim() || parent.closest('[torph-root], .sr-only')) continue
        if (opacity(parent) <= 0.05) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        rects.push(range.getBoundingClientRect())
      }
      return rects
    }
    const slot = title.querySelector('[data-slot="tool-status-swap"]')
    const parts = ['prefix', 'active', 'done', 'suffix'].map((name) =>
      glyphs(title.querySelector(`[data-slot="tool-status-${name}"]`)).filter(
        (rect) => rect.width > 0
      )
    )
    const bottoms = parts.flat().map((rect) => rect.bottom)
    if (bottoms.length && Math.max(...bottoms) - Math.min(...bottoms) > 1) found.push('baseline')
    if (slot) {
      const box = slot.getBoundingClientRect()
      const clipped = getComputedStyle(slot).overflowX !== 'visible'
      const middle = [...parts[1]!, ...parts[2]!].map((rect) => ({
        left: clipped ? Math.max(rect.left, box.left) : rect.left,
        right: clipped ? Math.min(rect.right, box.right) : rect.right,
      }))
      const visible = middle.filter((rect) => rect.right - rect.left > 0.5)
      const prefixRight = Math.max(-Infinity, ...parts[0]!.map((rect) => rect.right))
      const suffixLeft = Math.min(Infinity, ...parts[3]!.map((rect) => rect.left))
      if (visible.some((rect) => rect.right > suffixLeft + 0.5 || rect.left < prefixRight - 0.5))
        found.push('overlap')
    }
    return found
  }
  function piece(element: Element | null): Piece {
    if (!element) return { text: '', opacity: 0, lostSpaces: 0 }
    const value = ink(element)
    return { text: value.text, opacity: opacity(element), lostSpaces: value.lostSpaces }
  }
  function sample(): LabelFrame[] {
    return [
      ...card.querySelectorAll<HTMLElement>('[data-v2-row], .hybrid-now, [data-v2-heading]'),
    ].flatMap<LabelFrame>((row) => {
      if (opacity(row) <= 0.01 || row.getBoundingClientRect().height < 0.1) return []
      const title = row.querySelector<HTMLElement>('[data-component="tool-status-title"]')
      if (!title) {
        if (!row.matches('.hybrid-now, [data-v2-heading]')) {
          const all = ink(row)
          return [
            {
              id: row.dataset.v2Row!,
              label: false,
              expected: '',
              from: null,
              to: null,
              prefix: piece(null),
              old: piece(null),
              next: piece(row),
              suffix: piece(null),
              text: all.text,
              emptyNumbers: all.emptyNumbers,
              staticOpacity: [],
              problems: problems(row, null),
            },
          ]
        }
        const label = row.querySelector<HTMLElement>('.rolling-text-window') ?? row
        const paintedLabel = label.querySelector(':scope > .rolling-text-in') ?? label
        if (opacity(paintedLabel) <= 0.01) return []
        const next = piece(label)
        const all = ink(label)
        return [
          {
            id: row.hasAttribute('data-v2-heading') ? 'heading' : 'now',
            label: true,
            expected: row.dataset.v2Heading ?? label.getAttribute('aria-label') ?? '',
            from: null,
            to: null,
            prefix: piece(null),
            old: piece(null),
            next,
            suffix: piece(null),
            text: all.text,
            emptyNumbers: all.emptyNumbers,
            staticOpacity: [],
            problems: problems(row, null),
          },
        ]
      }
      if (opacity(title) <= 0.01) return []
      const prefix = piece(title.querySelector('[data-slot="tool-status-prefix"]'))
      const old = piece(title.querySelector('[data-slot="tool-status-active"]'))
      const next = piece(title.querySelector('[data-slot="tool-status-done"]'))
      const suffix = piece(title.querySelector('[data-slot="tool-status-suffix"]'))
      const all = ink(title)
      return [
        {
          id: row.dataset.v2Row ?? 'now',
          label: true,
          expected: title.getAttribute('aria-label')!,
          from: title.dataset.swapFrom ?? null,
          to: title.dataset.swapTo ?? null,
          prefix,
          old,
          next,
          suffix,
          text: all.text,
          emptyNumbers: all.emptyNumbers,
          staticOpacity: [prefix, suffix]
            .filter((part) => part.text)
            .map((part) => part.opacity / opacity(title)),
          problems: problems(row, title),
        },
      ]
    })
  }
  Object.assign(window, { __stateSample: sample })
}

function allowed(from: string, to: string) {
  let prefix = 0
  while (prefix < from.length && prefix < to.length && from[prefix] === to[prefix]) prefix++
  if (prefix < 2) prefix = 0
  let suffix = 0
  while (
    suffix < from.length - prefix &&
    suffix < to.length - prefix &&
    from.at(-suffix - 1) === to.at(-suffix - 1)
  )
    suffix++
  while (
    suffix &&
    !/\s/.test(to[to.length - suffix]!) &&
    !(
      /\s/.test(from[from.length - suffix - 1] ?? '') && /\s/.test(to[to.length - suffix - 1] ?? '')
    )
  )
    suffix--
  const head = to.slice(0, prefix)
  const tail = suffix ? to.slice(-suffix) : ''
  const old = from.slice(prefix, from.length - suffix)
  const next = to.slice(prefix, to.length - suffix)
  return [from, to, head + old + next + tail, head + next + old + tail]
}

async function prepare(page: Page, url: string, id: string) {
  await page.goto(`${url}/dev/stream-states?scan=1`)
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((font) => font.load()))
    await document.fonts.ready
  })
  const card = page.locator(`[data-state="${id}"]`)
  await card.scrollIntoViewIfNeeded()
  await card.getByRole('button', { name: /^Replay / }).click()
  await page.evaluate(installSampler, id)
}

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port!
  server.stop(true)
  return [5173, 5174, 8787, 5200, 8820].includes(port) ? freePort() : port
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return
    } catch {}
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function main() {
  const output = resolve(process.argv[2] ?? (await mkdtemp(join(tmpdir(), 'feel-states-'))))
  if (output === root || output.startsWith(`${root}/`))
    throw new Error('State output must be outside the repo')
  await mkdir(output, { recursive: true })
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
    await Promise.all([waitFor(`http://127.0.0.1:${serverPort}`), waitFor(url)])
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
    const reports = []
    let keyboardStep = false
    const failures: { card: string; frame: number; row: LabelFrame; reason: string }[] = []
    for (const card of streamStates.filter(
      (card) => !process.env.FEEL_STATES || process.env.FEEL_STATES.split(',').includes(card.id)
    )) {
      await prepare(page, url, card.id)
      const frames: StateFrame[] = []
      const previous = new Map<string, string>()
      const count = Math.ceil((card.duration + 1000) / frameMs)
      for (let frame = 0; frame <= count; frame++) {
        const rows =
          frame === 0
            ? await page.evaluate(() => (window as StateWindow).__stateSample())
            : await page.evaluate(() => {
                const state = window as StateWindow
                return state.__feelClock.step(state.__stateSample)
              })
        if (
          card.events.some(({ t }) =>
            [0, 1, 8, 18, 36].some((offset) => frame === Math.ceil(t / frameMs) + offset)
          )
        )
          await page
            .locator(`[data-state="${card.id}"]`)
            .screenshot({ path: join(output, `${card.id}-${frame}.png`), animations: 'allow' })
        frames.push({ frame, ms: Number((frame * frameMs).toFixed(1)), rows })
        for (const row of rows) {
          for (const reason of row.problems) failures.push({ card: card.id, frame, row, reason })
          if (!row.label) continue
          const from = row.from ?? previous.get(row.id) ?? row.expected
          const to = row.to ?? row.expected
          const options = allowed(from, to)
          if (row.id === 'heading') {
            const oldDuration = from.match(/ for [\dms ]+$/)?.[0]
            const nextDuration = to.match(/ for [\dms ]+$/)?.[0]
            if (oldDuration && nextDuration) {
              options.push(to.slice(0, -nextDuration.length) + oldDuration)
              options.push(from.slice(0, -oldDuration.length) + nextDuration)
            }
          }
          if (!options.includes(row.text))
            failures.push({ card: card.id, frame, row, reason: 'invalid visible label' })
          if ([row.prefix, row.old, row.next, row.suffix].some((part) => part.lostSpaces > 0))
            failures.push({ card: card.id, frame, row, reason: 'collapsed whitespace' })
          if (row.emptyNumbers)
            failures.push({ card: card.id, frame, row, reason: 'empty odometer' })
          if (row.staticOpacity.some((value) => Math.abs(value - 1) > 0.001))
            failures.push({ card: card.id, frame, row, reason: 'fading static prefix/suffix' })
          previous.set(row.id, row.expected)
        }
      }
      await Bun.write(
        join(output, `${card.id}.frames.jsonl`),
        frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n'
      )
      const report = {
        card: card.id,
        frames: frames.length,
        rowFrames: frames.reduce((total, frame) => total + frame.rows.length, 0),
        swapFrames: frames.filter((frame) => frame.rows.some((row) => row.from !== null)).length,
        findings: failures.filter((failure) => failure.card === card.id).length,
      }
      reports.push(report)
      console.log(JSON.stringify(report))
      if (!keyboardStep) {
        const before = await page.evaluate(() => (window as StateWindow).__feelClock.now())
        await page.keyboard.press('.')
        await page.waitForFunction(
          (before) => (window as StateWindow).__feelClock.now() > before,
          before,
          { polling: 100 }
        )
        const after = await page.evaluate(() => (window as StateWindow).__feelClock.now())
        if (Math.abs(after - before - frameMs) > 0.001)
          throw new Error('The . key must step exactly one fixed frame')
        keyboardStep = true
      }
      await page
        .locator(`[data-state="${card.id}"]`)
        .screenshot({ path: join(output, `${card.id}.png`) })
    }
    await Bun.write(
      join(output, 'report.json'),
      JSON.stringify({ frameMs, keyboardStep, reports, failures }, null, 2) + '\n'
    )
    await Bun.write(
      join(output, 'report.md'),
      `# Stream states frame check\n\n16.7ms fixed time-warp steps, sampled after native paint. Exact work-row text (including prose and markers), effective opacity, whitespace range widths and odometer ink are recorded in each card's JSONL. Aria-hidden copies are excluded; Torph rails are checked for painted digits before selecting the current or previous number. Label assertions cover activity titles, header timers and stand-ins (the header verb and its verified odometer may settle independently); prose and marker text is recorded for inspection. The . keyboard shortcut is checked against the same fixed-frame clock.\n\n| Card | Frames | Work row frames | Swap frames | Findings |\n| --- | ---: | ---: | ---: | ---: |\n${reports.map((report) => `| ${report.card} | ${report.frames} | ${report.rowFrames} | ${report.swapFrames} | ${report.findings} |`).join('\n')}\n\n${failures.length} findings.\n`
    )
    console.log(`Report: ${output}; ${failures.length} findings`)
    if (failures.length) process.exitCode = 1
  } finally {
    await browser?.close()
    for (const process of processes) process.kill()
    await Promise.all(processes.map((process) => process.exited))
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()
