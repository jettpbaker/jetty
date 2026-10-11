import { getMotionTokens } from '@/lib/motion'
import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

export const sendMotionTunerEnabled =
  import.meta.env.DEV && import.meta.env.VITE_SEND_MOTION_TUNER === '1'

export type SendMotionMode = 'gentle' | 'spring'

const key = 'jetty.dev.send-motion'
const listeners = new Set<() => void>()
let mode: SendMotionMode =
  sendMotionTunerEnabled && storage.get(key) === 'spring' ? 'spring' : 'gentle'

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setSendMotionMode(value: SendMotionMode) {
  mode = value
  storage.set(key, value)
  for (const listener of listeners) listener()
}

export function useSendMotionMode() {
  return useSyncExternalStore(subscribe, () => mode)
}

export function getSendMotionTransition() {
  if (sendMotionTunerEnabled) {
    if (mode === 'spring') return { type: 'spring' as const, duration: 0.45, bounce: 0 }
    return { duration: 0.35, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }
  }
  const { openMs, ease } = getMotionTokens().disclosure
  return { duration: openMs / 1000, ease }
}
