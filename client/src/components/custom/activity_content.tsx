import type { ReactNode } from 'react'

import { getMotionTokens } from '@/lib/motion'
import { motion, useReducedMotion } from 'motion/react'

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
  const { disclosure } = getMotionTokens()
  return (
    <motion.div
      id={id}
      initial={false}
      inert={!open}
      aria-hidden={!open}
      className='overflow-hidden'
      animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
      transition={{
        duration: reducedMotion ? 0 : (open ? disclosure.openMs : disclosure.closeMs) / 1000,
        ease: disclosure.ease,
      }}
    >
      <div className='pb-1'>{children}</div>
    </motion.div>
  )
}
