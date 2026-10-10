import { frame, frameSteps } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'

export const slowMoOptions = [
  { value: '1', label: '1×' },
  { value: '0.5', label: '½' },
  { value: '0.25', label: '¼' },
  { value: '0.1', label: '⅒' },
] as const
export type SlowMo = (typeof slowMoOptions)[number]['value']

type Timer = { due: number; delay: number }

// Only installed by /dev/feels. Native scheduling keeps the debugging controls live at scale 0.
export function installTimeWarp() {
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
  }
  const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
  const startTimeDescriptor = Object.getOwnPropertyDescriptor(Animation.prototype, 'startTime')!
  const realNow = original.now.bind(performance)
  let realBase = realNow()
  let clockBase = realBase
  const dateBase = original.dateNow() - clockBase
  let scale = 1
  let installed = true
  const timers = new Map<number, Timer>()
  const frames = new Map<number, { callback: FrameRequestCallback; native: number }>()
  const rates = new Map<Animation, number>()

  function now() {
    return clockBase + (realNow() - realBase) * scale
  }

  function adjust(animation: Animation) {
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
    const entry = { due: now() + delay, delay }
    const id = original.interval.call(
      window,
      () => {
        if (scale === 0 || now() < entry.due) return
        if (repeat) entry.due = now() + entry.delay
        else {
          original.clearInterval.call(window, id)
          timers.delete(id)
        }
        if (typeof handler === 'function') handler.apply(window, args)
        else original.timeout.call(window, handler, 0)
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

  function dispose() {
    const remaining = now()
    clockBase = realBase = realNow()
    scale = 1
    installed = false
    for (const entry of timers.values()) entry.due = clockBase + Math.max(0, entry.due - remaining)
    timers.clear()
    original.cancelRaf.call(window, scan)
    document.removeEventListener('animationstart', animations, true)
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
    Object.defineProperty(Animation.prototype, 'startTime', startTimeDescriptor)
    frame.read(() => {})
  }
  return { setScale, dispose }
}

export function useTimeWarp() {
  const warpRef = useRef<ReturnType<typeof installTimeWarp> | null>(null)
  const [slowMo, setSlowMo] = useState<SlowMo>('1')
  const [frozen, setFrozen] = useState(false)
  useLayoutEffect(() => {
    const warp = installTimeWarp()
    warpRef.current = warp
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '.' || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
        return
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            'input, textarea, select, button, a, summary, [role="button"], [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="radio"], [role="radiogroup"], [role="checkbox"], [role="switch"], [role="menu"], [role="menubar"], [role^="menuitem"], [role="listbox"], [role="option"], [role="tablist"], [role="tree"], [role="grid"], [contenteditable], [data-slot="toggle-group"]'
          ))
      )
        return
      event.preventDefault()
      setFrozen((value) => !value)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      warp.dispose()
      warpRef.current = null
    }
  }, [])
  useLayoutEffect(() => warpRef.current?.setScale(frozen ? 0 : Number(slowMo)), [frozen, slowMo])
  return { slowMo, setSlowMo, frozen, toggleFrozen: () => setFrozen((value) => !value) }
}
