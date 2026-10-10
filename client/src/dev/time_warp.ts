import { frame, frameData, frameSteps } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

export const speedOptions = [
  { value: '0.125', label: '0.125×' },
  { value: '0.25', label: '0.25×' },
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
] as const
type Speed = (typeof speedOptions)[number]['value']

type Timer = { due: number; delay: number; fire: () => void }

export const frameMs = 16.7

// Only installed by the dev replay pages. Native scheduling keeps the debugging controls live at scale 0.
export function installTimeWarp(fixed = false) {
  const original = {
    now: performance.now,
    dateNow: Date.now,
    raf: window.requestAnimationFrame,
    cancelRaf: window.cancelAnimationFrame,
    timeout: window.setTimeout,
    interval: window.setInterval,
    clearTimeout: window.clearTimeout,
    clearInterval: window.clearInterval,
    animate: Element.prototype.animate,
    finish: Animation.prototype.finish,
    resizeObserver: window.ResizeObserver,
  }
  const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
  const startTimeDescriptor = Object.getOwnPropertyDescriptor(Animation.prototype, 'startTime')!
  const realNow = original.now.bind(performance)
  let realBase = realNow()
  let clockBase = 0
  const dateBase = 1_700_000_000_000
  let scale = fixed ? 0 : 1
  let installed = true
  const timers = new Map<number, Timer>()
  const frames = new Map<number, { callback: FrameRequestCallback; native: number }>()
  const rates = new Map<Animation, number>()
  let frameNumber = 0
  const observers = new Map<
    ResizeObserver,
    { callback: ResizeObserverCallback; targets: Map<Element, string> }
  >()
  window.ResizeObserver = function (callback: ResizeObserverCallback) {
    const observer: ResizeObserver = {
      observe(target) {
        if (!observers.has(observer)) observers.set(observer, { callback, targets: new Map() })
        observers.get(observer)!.targets.set(target, '')
      },
      unobserve(target) {
        observers.get(observer)?.targets.delete(target)
      },
      disconnect() {
        observers.delete(observer)
      },
    }
    observers.set(observer, { callback, targets: new Map() })
    return observer
  } as unknown as typeof ResizeObserver

  // Deliver layout changes at the same virtual boundary, even when no native frame is painted.
  function resize() {
    for (const [observer, { callback, targets }] of observers) {
      const entries: ResizeObserverEntry[] = []
      for (const [target, previous] of targets) {
        const style = getComputedStyle(target)
        const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
        const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        const width = parseFloat(style.width) || 0
        const height = parseFloat(style.height) || 0
        const borderBox = style.boxSizing === 'border-box'
        const contentWidth = Math.max(0, width - (borderBox ? paddingX + borderX : 0))
        const contentHeight = Math.max(0, height - (borderBox ? paddingY + borderY : 0))
        const stamp = `${contentWidth}:${contentHeight}`
        if (stamp === previous) continue
        targets.set(target, stamp)
        const size = { inlineSize: contentWidth, blockSize: contentHeight }
        entries.push({
          target,
          contentRect: new DOMRectReadOnly(
            parseFloat(style.paddingLeft),
            parseFloat(style.paddingTop),
            contentWidth,
            contentHeight
          ),
          contentBoxSize: [size],
          borderBoxSize: [
            {
              inlineSize: contentWidth + paddingX + borderX,
              blockSize: contentHeight + paddingY + borderY,
            },
          ],
          devicePixelContentBoxSize: [
            {
              inlineSize: contentWidth * devicePixelRatio,
              blockSize: contentHeight * devicePixelRatio,
            },
          ],
        })
      }
      if (entries.length) callback(entries, observer)
    }
  }

  function now() {
    return scale === 0 ? clockBase : clockBase + (realNow() - realBase) * scale
  }

  function adjust(animation: Animation) {
    if (
      animation.playState === 'finished' ||
      (animation.timeline && animation.timeline !== document.timeline)
    )
      return
    let rate = rates.get(animation)
    if (rate === undefined) {
      rate = animation.playbackRate
      rates.set(animation, rate)
      if (
        (animation instanceof CSSAnimation || animation instanceof CSSTransition) &&
        typeof animation.currentTime === 'number'
      ) {
        animation.currentTime *= scale
      }
      if (scale === 0 && animation.currentTime === null) animation.currentTime = 0
    }
    if (animation.playbackRate !== rate * scale) animation.playbackRate = rate * scale
    if (fixed) {
      if (scale === 0) animation.pause()
      else if (animation.playState === 'paused') animation.play()
    }
  }

  function animations() {
    for (const animation of document.getAnimations()) adjust(animation)
    for (const animation of rates.keys()) {
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (animation.playState === 'idle' || (target instanceof Element && !target.isConnected)) {
        animation.playbackRate = rates.get(animation)!
        rates.delete(animation)
      }
    }
  }

  function setScale(next: number) {
    clockBase = now()
    realBase = realNow()
    scale = next
    animations()
    if (scale > 0) frame.read(() => {})
  }

  Object.defineProperty(performance, 'now', { configurable: true, value: now })
  Date.now = () => Math.floor(dateBase + now())
  window.requestAnimationFrame = (callback) => {
    const entry = { callback, native: 0 }
    const id = original.raf.call(window, tick)
    entry.native = id
    frames.set(id, entry)
    function tick(timestamp: number) {
      if (scale === 0) {
        entry.native = original.raf.call(window, tick)
        return
      }
      frames.delete(id)
      callback(installed ? now() : timestamp)
    }
    return id
  }
  window.cancelAnimationFrame = (id) => {
    original.cancelRaf.call(window, frames.get(id)?.native ?? id)
    frames.delete(id)
  }

  // Keep native IDs so clearTimeout/clearInterval still work after globals are restored.
  // The short native pulse checks a virtual deadline; scale changes preserve time remaining.
  function timer(handler: TimerHandler, timeout = 0, args: unknown[], repeat: boolean) {
    const delay = Math.max(0, Math.min(Number(timeout) || 0, 2_147_483_647))
    const entry = { due: now() + delay, delay, fire }
    function fire() {
      if (repeat) entry.due = now() + entry.delay
      else {
        original.clearInterval.call(window, id)
        timers.delete(id)
      }
      if (typeof handler === 'function') handler.apply(window, args)
      else original.timeout.call(window, handler, 0)
    }
    const id = original.interval.call(
      window,
      () => {
        if (scale > 0 && now() >= entry.due) fire()
      },
      Math.max(1, Math.min(delay, 8))
    )
    if (installed) timers.set(id, entry)
    return id
  }
  window.setTimeout = (handler, timeout, ...args) => timer(handler, timeout, args, false)
  window.setInterval = (handler, timeout, ...args) => timer(handler, timeout, args, true)
  function clearTimer(id?: number) {
    original.clearTimeout.call(window, id)
    timers.delete(id!)
  }
  window.clearTimeout = clearTimer
  window.clearInterval = clearTimer

  Element.prototype.animate = function (keyframes, options) {
    const animation = original.animate.call(this, keyframes, options)
    adjust(animation)
    return animation
  }
  // WAAPI refuses to finish an animation at playbackRate 0, and settling a scrub finishes them.
  Animation.prototype.finish = function () {
    const rate = rates.get(this)
    if (rate !== undefined) {
      this.playbackRate = rate
      rates.delete(this)
    }
    original.finish.call(this)
  }
  // Motion gives WAAPI a performance.now() start time; its timeline still uses real time.
  Object.defineProperty(Animation.prototype, 'startTime', {
    ...startTimeDescriptor,
    set(value: CSSNumberish | null) {
      const start = typeof value === 'number' ? realNow() - (now() - value) / (scale || 1) : value
      startTimeDescriptor.set!.call(this, start)
    },
  })
  document.addEventListener('animationstart', animations, true)
  document.addEventListener('transitionrun', animations, true)
  let scan = original.raf.call(window, scanAnimations)
  function scanAnimations() {
    animations()
    if (scale > 0) resize()
    scan = original.raf.call(window, scanAnimations)
  }

  // Motion captures native rAF at import time. Leave its queues untouched while frozen.
  const steps = Object.values(frameSteps).map((step) => {
    const process = step.process
    step.process = (data) => {
      if (scale > 0) process(data)
    }
    return { step, process }
  })
  animations()

  function finishStep(animation: Animation) {
    animation.addEventListener(
      'finish',
      (event) => {
        if (event.isTrusted) event.stopImmediatePropagation()
      },
      { capture: true }
    )
    animation.finish()
    animation.dispatchEvent(
      new AnimationPlaybackEvent('finish', { currentTime: animation.currentTime as number })
    )
    const target = (animation.effect as KeyframeEffect | null)?.target
    if (animation instanceof CSSAnimation && target) {
      target.dispatchEvent(
        new AnimationEvent('animationend', {
          bubbles: true,
          animationName: animation.animationName,
        })
      )
    } else if (animation instanceof CSSTransition && target) {
      target.dispatchEvent(
        new TransitionEvent('transitionend', {
          bubbles: true,
          propertyName: animation.transitionProperty,
        })
      )
    }
  }
  function suppressNativeEnd(event: Event) {
    if (scale === 0 && event.isTrusted) event.stopImmediatePropagation()
  }
  document.addEventListener('animationend', suppressNativeEnd, true)
  document.addEventListener('transitionend', suppressNativeEnd, true)

  // Run one page frame while native scheduling continues to service React and the controls.
  function step<T>(sample?: () => T, paint = true): Promise<T | undefined> {
    if (scale !== 0) return Promise.resolve(undefined)
    frameNumber++
    clockBase += frameMs
    for (const [animation, rate] of rates) {
      if (typeof animation.currentTime !== 'number') continue
      animation.currentTime += frameMs * rate
      const end = animation.effect?.getComputedTiming().endTime
      if (typeof end === 'number' && animation.currentTime >= end) finishStep(animation)
    }
    flushSync(() => {
      for (const [id, entry] of Array.from(timers)) {
        if (timers.has(id) && entry.due <= now()) entry.fire()
      }
      for (const [id, entry] of Array.from(frames)) {
        if (!frames.has(id)) continue
        original.cancelRaf.call(window, entry.native)
        frames.delete(id)
        entry.callback(now())
      }
      Object.assign(frameData, { delta: frameMs, timestamp: now(), isProcessing: true })
      for (const { process } of steps) process(frameData)
      frameData.isProcessing = false
    })
    flushSync(resize)
    animations()
    if (!paint) return Promise.resolve(sample?.())
    return new Promise((resolve) => {
      original.raf.call(window, () => {
        animations()
        original.timeout.call(window, () => resolve(sample?.()), 0)
      })
    })
  }

  function dispose() {
    const remaining = now()
    clockBase = realBase = realNow()
    scale = 1
    installed = false
    for (const entry of timers.values()) entry.due = clockBase + Math.max(0, entry.due - remaining)
    timers.clear()
    original.cancelRaf.call(window, scan)
    document.removeEventListener('animationstart', animations, true)
    document.removeEventListener('animationend', suppressNativeEnd, true)
    document.removeEventListener('transitionend', suppressNativeEnd, true)
    document.removeEventListener('transitionrun', animations, true)
    for (const [animation, rate] of rates) animation.playbackRate = rate
    rates.clear()
    for (const { step, process } of steps) step.process = process
    frames.clear()
    if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor)
    else Reflect.deleteProperty(performance, 'now')
    Date.now = original.dateNow
    window.requestAnimationFrame = original.raf
    window.cancelAnimationFrame = original.cancelRaf
    window.setTimeout = original.timeout
    window.setInterval = original.interval
    window.clearTimeout = original.clearTimeout
    window.clearInterval = original.clearInterval
    Element.prototype.animate = original.animate
    Animation.prototype.finish = original.finish
    window.ResizeObserver = original.resizeObserver
    Object.defineProperty(Animation.prototype, 'startTime', startTimeDescriptor)
    frame.read(() => {})
  }
  return {
    setScale,
    step,
    now,
    dispose,
    frame: () => frameNumber,
    nativeFrame: (callback: FrameRequestCallback) => original.raf.call(window, callback),
    realNow,
  }
}

export function useTimeWarp(fixed = false) {
  const warpRef = useRef<ReturnType<typeof installTimeWarp> | null>(null)
  const [speed, setSpeed] = useState<Speed>('1')
  const [frozen, setFrozen] = useState(fixed)
  const [ready, setReady] = useState(false)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [rebuilding, setRebuilding] = useState(false)
  const seekRef = useRef<number | null>(null)
  const targetRef = useRef(0)
  const steppingRef = useRef(false)
  useLayoutEffect(() => {
    const warp = installTimeWarp(fixed)
    if (fixed) Object.assign(window, { __feelClock: warp })
    warpRef.current = warp
    setReady(true)
    return () => {
      warpRef.current?.dispose()
      warpRef.current = null
    }
  }, [fixed])
  useLayoutEffect(() => {
    const warp = warpRef.current!
    warp.setScale(frozen ? 0 : Number(speed))
    if (!frozen && steppingRef.current) targetRef.current = warp.frame()
    if (frozen) setCurrentFrame(seekRef.current ?? Math.round(warp.now() / frameMs))
  }, [frozen, speed])
  function reset(restart: () => void, paused = frozen) {
    flushSync(() => setReady(false))
    warpRef.current!.dispose()
    const warp = installTimeWarp(true)
    warpRef.current = warp
    if (fixed) Object.assign(window, { __feelClock: warp })
    warp.setScale(paused ? 0 : Number(speed))
    seekRef.current = null
    flushSync(() => {
      setCurrentFrame(0)
      setReady(true)
      restart()
    })
    return warp
  }
  async function step() {
    const warp = warpRef.current!
    if (!frozen) {
      warp.setScale(0)
      setFrozen(true)
    }
    await warp.step()
    setCurrentFrame(warp.frame())
  }
  function seekFrame(at: number) {
    seekRef.current = Math.round(at / frameMs)
    setCurrentFrame(seekRef.current)
  }
  async function move(direction: number, restart: () => void, playing: boolean) {
    let warp = warpRef.current!
    if (!frozen) {
      warp.setScale(0)
      setFrozen(true)
      setCurrentFrame(seekRef.current ?? Math.round(warp.now() / frameMs))
      if (playing) return
    }
    targetRef.current = Math.max(
      0,
      (steppingRef.current
        ? targetRef.current
        : (seekRef.current ?? Math.round(warp.now() / frameMs))) + direction
    )
    if (steppingRef.current) return
    steppingRef.current = true
    try {
      while (warpRef.current === warp) {
        if (
          targetRef.current < warp.frame() ||
          seekRef.current !== null ||
          Math.abs(warp.now() - warp.frame() * frameMs) > 0.01
        ) {
          flushSync(() => setRebuilding(true))
          warp = reset(restart, true)
        }
        const deadline = warp.realNow() + 12
        while (warp.frame() < targetRef.current && warp.realNow() < deadline)
          await warp.step(undefined, false)
        if (warp.frame() === targetRef.current) {
          setCurrentFrame(warp.frame())
          break
        }
        await new Promise<void>((resolve) => warp.nativeFrame(() => resolve()))
      }
    } finally {
      steppingRef.current = false
      setRebuilding(false)
    }
  }
  return {
    speed,
    setSpeed,
    frozen,
    setFrozen,
    ready,
    currentFrame,
    step,
    rebuilding,
    move,
    reset,
    seekFrame,
  }
}
