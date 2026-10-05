import { storage } from '@/platform'

// How a streaming reply's new text appears. A per-browser preference while the styles are compared.
export const streamingStyles = [
  { value: 'fade', label: 'Fade' },
  { value: 'quick', label: 'Quick fade' },
  { value: 'blur', label: 'Blur in' },
  { value: 'off', label: 'Off' },
] as const

export type StreamingStyle = (typeof streamingStyles)[number]['value']

const storageKey = 'jetty:streaming-style'

export function readStreamingStyle(): StreamingStyle {
  const stored = storage.get(storageKey)
  return streamingStyles.find(({ value }) => value === stored)?.value ?? 'fade'
}

export function saveStreamingStyle(style: StreamingStyle) {
  storage.set(storageKey, style)
}
