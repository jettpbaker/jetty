import type { ReactNode } from 'react'

import { useChatFeel, useChatSettled } from '@/lib/chat-feel'
import { motion, useReducedMotion } from 'motion/react'

import { capyMotion } from './chat_feel/capy'
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
  return (
    <motion.div
      id={id}
      initial={false}
      onAnimationComplete={() => {
        if (!open) onFolded?.()
      }}
      inert={!open}
      aria-hidden={!open}
      className='overflow-hidden'
      animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
      transition={
        settled
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
