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
  immediate = false
) {
  const queue = useContext(DiscreteContext)
  const feel = useChatFeel()
  const settled = useChatSettled()
  const enabled = queue !== null && feel === 'hybrid' && !settled && !immediate
  const owner = useRef({})
  const elementRef = useRef<E | null>(null)
  const [shown, setShown] = useState({ value: initial, animate: false })
  const ownerValue = owner.current

  const finish = useCallback(() => {
    if (elementRef.current) elementRef.current.dataset.discreteRunning = 'false'
    queue?.finish(ownerValue)
  }, [queue, ownerValue])

  useLayoutEffect(() => {
    if (Object.is(target, shown.value)) return
    if (!enabled) {
      queue?.cancel(ownerValue)
      queue?.finish(ownerValue)
      setShown({ value: target, animate: false })
      return
    }
    queue.request(ownerValue, label, (animate) => setShown({ value: target, animate }))
    return () => queue.cancel(ownerValue)
  }, [target, shown.value, enabled, queue, ownerValue, label])

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
