import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

export const scrollFadeTunerEnabled = import.meta.env.DEV && import.meta.env.VITE_CHAT_TUNER === '1'

const key = 'jetty.dev.scroll-fade'
const listeners = new Set<() => void>()
export type ScrollFadeMode = 't3' | 'opencode'
let mode: ScrollFadeMode = storage.get(key) === 't3' ? 't3' : 'opencode'

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setScrollFadeMode(value: ScrollFadeMode) {
  mode = value
  storage.set(key, value)
  for (const listener of listeners) listener()
}

export function useScrollFadeMode() {
  return useSyncExternalStore(subscribe, () => (scrollFadeTunerEnabled ? mode : undefined))
}
