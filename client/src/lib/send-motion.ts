import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

export const sendMotionTunerEnabled =
  import.meta.env.DEV && import.meta.env.VITE_SEND_MOTION_TUNER === '1'

export type SendMotionMode = 'gentle' | 'spring'

const key = 'jetty.dev.send-motion'
const listeners = new Set<() => void>()
let mode: SendMotionMode =
  sendMotionTunerEnabled && storage.get(key) === 'gentle' ? 'gentle' : 'spring'

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
  if (sendMotionTunerEnabled && mode === 'gentle') {
    return { duration: 0.35, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }
  }
  return { type: 'spring' as const, duration: 0.3, bounce: 0 }
}
