import type { usePullRequestActions, PullRequestRef } from '@/state/pull_requests'

import { createContext, useContext, type ReactNode } from 'react'

import type { LoadDiffFile } from '../file_diff_model'

export type PrRuntime = {
  ref: PullRequestRef
  actions: ReturnType<typeof usePullRequestActions>
  threads: readonly { id: string; title: string }[]
  more: ReactNode
  sidebar: ReactNode
}
export const PrRuntimeContext = createContext<PrRuntime | null>(null)
export function usePrRuntime() {
  const runtime = useContext(PrRuntimeContext)
  if (!runtime) throw new Error('Pull request runtime unavailable')
  return runtime
}
export const PrDiffRevisionContext = createContext('')
export const PrDiffLoaderContext = createContext<LoadDiffFile | undefined>(undefined)
