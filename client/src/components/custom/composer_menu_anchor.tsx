import { createContext, type RefObject } from 'react'

export const ComposerMenuAnchorContext = createContext<
  RefObject<HTMLDivElement | null> | undefined
>(undefined)
