import { createContext } from 'react'

export type DiffFile = {
  path: string
  previousPath?: string
  status: 'modified' | 'added' | 'removed' | 'renamed'
  additions: number
  deletions: number
  binary?: boolean
}

export const DiffStyleContext = createContext<'unified' | 'split'>('unified')
export const DiffWrapContext = createContext(false)

// The file tree's order (folders before files at each level, then by name), so the diffs read in the
// order the tree lists them.
export function byTreeOrder(a: { path: string }, b: { path: string }) {
  if (a.path === b.path) return 0
  const x = a.path.split('/')
  const y = b.path.split('/')
  for (let i = 0; ; i++) {
    if (x[i] === y[i]) continue
    const xFolder = i < x.length - 1
    const yFolder = i < y.length - 1
    if (xFolder !== yFolder) return xFolder ? -1 : 1
    return x[i]!.localeCompare(y[i]!, undefined, { sensitivity: 'base', numeric: true })
  }
}
