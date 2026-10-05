import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

// How a streaming reply's new text appears. A per-browser preference while the styles are compared.
export const streamingStyles = [
  { value: 'fade', label: 'Fade' },
  { value: 'quick', label: 'Quick fade' },
  { value: 'blur', label: 'Blur 4px' },
  { value: 'softBlur', label: 'Blur 2px' },
  { value: 'faintBlur', label: 'Blur 1px' },
  { value: 'sharpen', label: 'Sharpen early' },
  { value: 'ink', label: 'Ink in' },
  { value: 'off', label: 'Off' },
] as const

export type StreamingStyle = (typeof streamingStyles)[number]['value']

const storageKey = 'jetty:streaming-style'
const listeners = new Set<() => void>()

export function readStreamingStyle(): StreamingStyle {
  const stored = storage.get(storageKey)
  return streamingStyles.find(({ value }) => value === stored)?.value ?? 'fade'
}

export function saveStreamingStyle(style: StreamingStyle) {
  storage.set(storageKey, style)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useStreamingStyle() {
  return useSyncExternalStore(subscribe, readStreamingStyle)
}
