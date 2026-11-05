import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

function createRequestTargets() {
  const targets = new Map<string, HTMLDivElement>()
  const listeners = new Set<() => void>()
  return {
    get: (id: string | undefined) => (id ? targets.get(id) : undefined),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach(id: string, element: HTMLDivElement) {
      targets.set(id, element)
      for (const listener of listeners) listener()
      return () => {
        targets.delete(id)
        for (const listener of listeners) listener()
      }
    },
  }
}

const RequestTargets = createContext<ReturnType<typeof createRequestTargets> | undefined>(undefined)

export function InlineRequests({ children }: { children: ReactNode }) {
  const [targets] = useState(createRequestTargets)
  return <RequestTargets value={targets}>{children}</RequestTargets>
}

export function InlineRequestTarget({ id }: { id: string }) {
  const targets = useContext(RequestTargets)
  const attach = useMemo(
    () => (element: HTMLDivElement | null) => {
      if (element) return targets?.attach(id, element)
    },
    [targets, id]
  )
  return <div ref={attach} data-inline-request={id} />
}

const noSubscription = () => () => {}

export function useInlineRequestTarget(id: string | undefined) {
  const targets = useContext(RequestTargets)
  return useSyncExternalStore(targets?.subscribe ?? noSubscription, () => targets?.get(id))
}
