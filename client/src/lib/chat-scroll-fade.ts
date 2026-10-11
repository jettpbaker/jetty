import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

export const scrollFadeTunerEnabled = import.meta.env.DEV && import.meta.env.VITE_CHAT_TUNER === '1'

const key = 'jetty.dev.scroll-edge-style'
const listeners = new Set<() => void>()
export type ScrollFadeMode = 'jetty' | 't3' | 'opencode'
const saved = storage.get(key)
let mode: ScrollFadeMode = saved === 't3' || saved === 'opencode' ? saved : 'jetty'

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
