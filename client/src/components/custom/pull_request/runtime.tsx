import type { usePullRequestActions, LinkedThread, PullRequestRef } from '@/state/pull_requests'

import { whenIdle } from '@/lib/preload'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import type { LoadDiffFile } from '../file_diff_model'

export type PrRuntime = {
  ref: PullRequestRef
  actions: ReturnType<typeof usePullRequestActions>
  threads: readonly LinkedThread[]
  more: ReactNode
  sidebar: ReactNode
}
export const PrRuntimeContext = createContext<PrRuntime | null>(null)
export const PrPaintedContext = createContext(true)
export function AfterPrPaint({ children }: { children: ReactNode }) {
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    let next = 0
    let cancelIdle: (() => void) | undefined
    const frame = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => {
        cancelIdle = whenIdle(() => setPainted(true))
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(next)
      cancelIdle?.()
    }
  }, [])
  return <PrPaintedContext value={painted}>{children}</PrPaintedContext>
}

export function usePrRuntime() {
  const runtime = useContext(PrRuntimeContext)
  if (!runtime) throw new Error('Pull request runtime unavailable')
  return runtime
}
export const PrDiffRevisionContext = createContext('')
export const PrDiffLoaderContext = createContext<LoadDiffFile | undefined>(undefined)
