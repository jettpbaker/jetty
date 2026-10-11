import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

export const scrollFadeTunerEnabled = import.meta.env.DEV && import.meta.env.VITE_CHAT_TUNER === '1'

const key = 'jetty.dev.scroll-fade'
const listeners = new Set<() => void>()
let enabled = scrollFadeTunerEnabled && storage.get(key) !== 'off'

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setScrollFade(value: boolean) {
  enabled = scrollFadeTunerEnabled && value
  storage.set(key, value ? 'on' : 'off')
  for (const listener of listeners) listener()
}

export function useScrollFade() {
  return useSyncExternalStore(subscribe, () => enabled)
}
