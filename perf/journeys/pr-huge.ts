import { hugeFixtures, hugeRef } from '../huge'
import { click, waitFor, type Ctx, type Journey } from '../journey'

const path = `/pull-requests/${hugeRef.repo}/${hugeRef.number}`
const diffTab = `[...document.querySelectorAll('nav[aria-label="Pull request view"] button')].find((tab) => tab.textContent.trim() === 'Diff')`
const painted = `(() => {
  const diff = document.querySelector('[aria-label="File diffs"] diffs-container')
  return !!diff?.getClientRects().length && !!diff.shadowRoot?.querySelector('pre [data-line]')
})()`

async function overview(ctx: Ctx) {
  const snapshot = await ctx.rpc.request('pullRequest.refresh', hugeRef)
  if (snapshot.status !== 'ready') throw new Error(snapshot.error ?? snapshot.status)
  await ctx.page.navigate(`${ctx.origin}${path}`)
  await waitFor(ctx.page, diffTab, 'the huge PR overview', 60_000)
}

const env = { PERF_GH_FIXTURES: hugeFixtures, JETTY_PR_FETCH_DEBUG: '1' }

const diff: Journey = {
  name: 'pr.diff',
  case: 'huge',
  optIn: true,
  domOnly: true,
  env,
  setup: overview,
  async act(ctx) {
    await click(ctx.page, diffTab, 'the Diff tab')
  },
  done: () => painted,
}

const scroll: Journey = {
  ...diff,
  name: 'pr.scroll',
  async setup(ctx) {
    await overview(ctx)
    await click(ctx.page, diffTab, 'the Diff tab')
    await waitFor(ctx.page, painted, 'the first diff body', 60_000)
  },
  async act(ctx) {
    const at = await ctx.page.evaluate<{ x: number; y: number }>(`(() => {
      const rect = document.querySelector('[aria-label="File diffs"]').getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: Math.min(rect.bottom - 40, rect.y + 200) }
    })()`)
    await ctx.page.evaluate(`(() => {
      const sample = { frames: 0, missedFrames: 0, blankFrames: 0, maxGapMs: 0, probeMs: 0, tasks: [], running: true }
      sample.startScrollTop = document.querySelector('[aria-label="File diffs"]').scrollTop
      window.__hugeScroll = sample
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) sample.tasks.push(entry.duration)
      })
      observer.observe({ type: 'longtask' })
      const instrumentAt = performance.now()
      const visible = new Set()
      const visibility = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target)
          else visible.delete(entry.target)
        }
      }, { root: document.querySelector('[aria-label="File diffs"]') })
      for (const body of document.querySelectorAll('[aria-label="File diffs"] .file-card-body')) visibility.observe(body)
      sample.probeMs += performance.now() - instrumentAt
      let last = performance.now()
      function frame() {
        const now = performance.now()
        if (!sample.running) { observer.disconnect(); visibility.disconnect(); return }
        const gap = now - last
        sample.frames++
        sample.maxGapMs = Math.max(sample.maxGapMs, gap)
        sample.missedFrames += Math.max(0, Math.round(gap / (1000 / 60)) - 1)

        if ([...visible].some((body) => body.firstElementChild?.getAttribute('aria-hidden') === 'true' || body.textContent.includes('Loading diff…') || (body.querySelector('diffs-container') && !body.querySelector('diffs-container').shadowRoot?.querySelector('pre [data-line]')))) sample.blankFrames++
        sample.probeMs += performance.now() - now
        last = now
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })()`)
    for (const deltaY of [600, 600, 1200, 1200, 2400, 2400, -1200, -1200, -600, -600]) {
      await ctx.page.cdp('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        ...at,
        deltaX: 0,
        deltaY,
      })
      await Bun.sleep(200)
    }
    await Bun.sleep(300)
    await ctx.page.evaluate('window.__hugeScroll.running = false')
  },
  done: () => '!window.__hugeScroll.running',
  async metrics(ctx) {
    return ctx.page.evaluate(`(() => {
      const sample = window.__hugeScroll
      return {
        scrollDistance: document.querySelector('[aria-label="File diffs"]').scrollTop - sample.startScrollTop,
        scrollProbeMs: sample.probeMs,
        scrollFrames: sample.frames,
        missedFrames: sample.missedFrames,
        blankFrames: sample.blankFrames,
        maxFrameGapMs: sample.maxGapMs,
        longTasks: sample.tasks.length,
        totalBlockingMs: sample.tasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0),
      }
    })()`)
  },
}

export const hugeJourneys = [diff, scroll]
