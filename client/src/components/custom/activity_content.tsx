import type { ReactNode } from 'react'

import { getChatFeel } from '@/lib/chat-feel'
import { motion, useReducedMotion } from 'motion/react'

import { capyMotion } from './chat_feel/capy'

export function ActivityContent({
  id,
  open,
  children,
}: {
  id: string
  open: boolean
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  return (
    <motion.div
      id={id}
      initial={false}
      inert={!open}
      aria-hidden={!open}
      className='overflow-hidden'
      animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
      transition={
        getChatFeel() === 'capy'
          ? capyMotion(open, reducedMotion)
          : { duration: reducedMotion ? 0 : 0.25, ease: [0.25, 1, 0.5, 1] }
      }
    >
      <div className='pb-1'>{children}</div>
    </motion.div>
  )
}
