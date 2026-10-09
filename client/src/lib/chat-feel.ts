import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

// An experiment: the thread rendered the way Capy, Cursor or opencode render theirs, to feel which
// one Jetty's should become. ⌥⌘F cycles; components/custom/chat_feel/ holds each one.
export const chatFeels = ['jetty', 'capy', 'cursor', 'opencode'] as const
export type ChatFeel = (typeof chatFeels)[number]
export const chatFeelNames: Record<ChatFeel, string> = {
  jetty: 'Jetty',
  capy: 'Capy',
  cursor: 'Cursor',
  opencode: 'opencode',
}

const key = 'jetty.chatFeel'
const listeners = new Set<() => void>()
let current: ChatFeel = chatFeels.find((feel) => feel === storage.get(key)) ?? 'jetty'

export function getChatFeel() {
  return current
}

export function applyChatFeel() {
  document.documentElement.dataset.chatFeel = current
}

export function cycleChatFeel() {
  current = chatFeels[(chatFeels.indexOf(current) + 1) % chatFeels.length]!
  storage.set(key, current)
  applyChatFeel()
  for (const listener of listeners) listener()
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function useChatFeel() {
  return useSyncExternalStore(subscribe, getChatFeel)
}
