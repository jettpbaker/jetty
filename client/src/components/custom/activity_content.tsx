import type { ReactNode } from 'react'

import { useChatFeel, useChatSettled, useHybridRows } from '@/lib/chat-feel'
import { motion, useReducedMotion } from 'motion/react'

import { capyMotion } from './chat_feel/capy'
import { useDiscrete } from './chat_feel/discrete'
import { hybridFold } from './chat_feel/hybrid'

export function ActivityContent({
  id,
  open,
  children,
  turnEnd = false,
  onFolded,
}: {
  id: string
  open: boolean
  children: ReactNode
  turnEnd?: boolean
  onFolded?: () => void
}) {
  const reducedMotion = useReducedMotion()
  const feel = useChatFeel()
  const settled = useChatSettled()
  const cursor = feel === 'cursor'
  const instant = useHybridRows() === 'instant' && feel === 'hybrid'
  const fold = useDiscrete(open, open, 'activity fold')
  const foldRef = fold.elementRef
  return (
    <motion.div
      ref={foldRef}
      data-discrete-running='false'
      onAnimationStart={() => {
        if (fold.animate && foldRef.current) foldRef.current.dataset.discreteRunning = 'true'
      }}
      id={id}
      initial={false}
      onAnimationComplete={(definition) => {
        if (
          typeof definition !== 'object' ||
          !('opacity' in definition) ||
          definition.opacity !== (fold.value ? 1 : 0)
        )
          return
        fold.finish()
        if (!fold.value) onFolded?.()
      }}
      inert={!fold.value}
      aria-hidden={!fold.value}
      className='overflow-hidden'
      animate={{ height: fold.value ? 'auto' : 0, opacity: fold.value ? 1 : 0 }}
      transition={
        settled || instant || !fold.animate
          ? { duration: 0 }
          : feel === 'hybrid' && turnEnd
            ? hybridFold(open, reducedMotion)
            : feel === 'capy' || feel === 'hybrid'
              ? capyMotion(open, reducedMotion)
              : {
                  duration: reducedMotion ? 0 : cursor ? 0.15 : 0.25,
                  ease: cursor ? [0.215, 0.61, 0.355, 1] : [0.25, 1, 0.5, 1],
                }
      }
    >
      <div className='pb-1'>{children}</div>
    </motion.div>
  )
}
