import { useChatFeel, useChatSettled } from '@/lib/chat-feel'
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type Request = { owner: object; at: number; label: string; apply: (animate: boolean) => void }

function createQueue() {
  let running: Request | undefined
  let waiting: Request[] = []
  const metrics: {
    maxWait: number
    example?: { label: string; requested: number; started: number; animate: boolean }
  } = { maxWait: 0 }

  function apply(request: Request, animate: boolean) {
    const started = performance.now()
    const wait = started - request.at
    if (wait > metrics.maxWait) {
      metrics.maxWait = wait
      metrics.example = { label: request.label, requested: request.at, started, animate }
    }
    request.apply(animate)
  }

  function finish(owner: object) {
    if (running?.owner !== owner) return
    running = undefined
    const batch = waiting
    waiting = []
    const newest = batch.pop()
    for (const request of batch) apply(request, false)
    if (newest) {
      running = newest
      apply(newest, true)
    }
  }

  function cancel(owner: object) {
    waiting = waiting.filter((request) => request.owner !== owner)
  }

  function request(owner: object, label: string, apply: Request['apply']) {
    cancel(owner)
    const next = { owner, label, apply, at: performance.now() }
    if (running) waiting.push(next)
    else {
      running = next
      apply(true)
    }
  }

  return { request, cancel, finish, metrics }
}

const DiscreteContext = createContext<ReturnType<typeof createQueue> | null>(null)

export function DiscreteProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(createQueue)
  return <DiscreteContext value={queue}>{children}</DiscreteContext>
}

// CSS transitions finish through their native animations; Motion calls finish itself.
export function useDiscrete<T, E extends HTMLElement = HTMLDivElement>(
  target: T,
  initial: T,
  label: string,
  css = false,
  immediate = false,
  holdMs = 0
) {
  const queue = useContext(DiscreteContext)
  const feel = useChatFeel()
  const settled = useChatSettled()
  const enabled = queue !== null && feel === 'hybrid' && !settled && !immediate
  const owner = useRef({})
  const elementRef = useRef<E | null>(null)
  const [shown, setShown] = useState({ value: initial, animate: false })
  const [readyAt, setReadyAt] = useState<number | null>(null)
  const holdFrame = useRef(0)
  const ownerValue = owner.current

  const finish = useCallback(() => {
    if (elementRef.current) elementRef.current.dataset.discreteRunning = 'false'
    if (holdMs) {
      cancelAnimationFrame(holdFrame.current)
      holdFrame.current = requestAnimationFrame(() => setReadyAt(performance.now() + holdMs))
    }
    queue?.finish(ownerValue)
  }, [queue, ownerValue, holdMs])

  useLayoutEffect(() => {
    if (!enabled || !holdMs || readyAt !== null) return
    let frame = 0
    function checkVisible() {
      const element = elementRef.current
      const rect = element?.getBoundingClientRect()
      let visible = !!rect && rect.width > 0 && rect.height > 0
      for (let node = element; node && visible; node = node.parentElement as E | null) {
        const css = getComputedStyle(node)
        visible =
          css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0.01
        if (rect && (css.overflowY === 'hidden' || css.overflowY === 'clip')) {
          const clip = node.getBoundingClientRect()
          visible &&= rect.bottom > clip.top && rect.top < clip.bottom
        }
      }
      if (visible) setReadyAt(performance.now() + holdMs)
      else frame = requestAnimationFrame(checkVisible)
    }
    frame = requestAnimationFrame(checkVisible)
    return () => cancelAnimationFrame(frame)
  }, [enabled, holdMs, readyAt])

  useLayoutEffect(() => {
    if (Object.is(target, shown.value)) return
    if (!enabled) {
      queue?.cancel(ownerValue)
      queue?.finish(ownerValue)
      setShown({ value: target, animate: false })
      return
    }
    function request() {
      queue!.request(ownerValue, label, (animate) => {
        if (holdMs) {
          setReadyAt(Infinity)
          if (!animate) {
            cancelAnimationFrame(holdFrame.current)
            holdFrame.current = requestAnimationFrame(() => setReadyAt(performance.now() + holdMs))
          }
        }
        setShown({ value: target, animate })
      })
    }
    if (holdMs && (readyAt === null || readyAt === Infinity)) return
    const delay = holdMs ? Math.max(0, (readyAt ?? 0) - performance.now()) : 0
    const timer = delay ? setTimeout(request, delay) : undefined
    if (!delay) request()
    return () => {
      clearTimeout(timer)
      queue.cancel(ownerValue)
    }
  }, [target, shown.value, enabled, queue, ownerValue, label, holdMs, readyAt])

  useLayoutEffect(() => {
    if (!css || !shown.animate) return
    const animations =
      elementRef.current
        ?.getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations === 1 &&
            ((animation instanceof CSSAnimation &&
              animation.animationName.startsWith('rolling-text-')) ||
              (animation instanceof CSSTransition && animation.transitionProperty === 'color'))
        ) ?? []
    if (!animations.length) {
      finish()
      return
    }
    let cancelled = false
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) finish()
    })
    return () => {
      cancelled = true
    }
  }, [shown, css, finish])

  useLayoutEffect(() => {
    const element = elementRef.current
    if (element && queue) {
      const thread = element.closest('[data-chat-thread]') as HTMLElement & {
        feelQueue?: typeof queue.metrics
      }
      if (thread) thread.feelQueue = queue.metrics
    }
  }, [queue])

  useLayoutEffect(
    () => () => {
      cancelAnimationFrame(holdFrame.current)
      queue?.cancel(ownerValue)
      queue?.finish(ownerValue)
    },
    [queue, ownerValue]
  )

  return {
    value: enabled ? shown.value : target,
    animate: enabled ? shown.animate : !settled,
    elementRef,
    finish,
  }
}
