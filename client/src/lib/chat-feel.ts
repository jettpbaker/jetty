import { storage } from '@/platform'
import { createContext, useContext, useSyncExternalStore } from 'react'

// An experiment: the thread rendered the way Capy, Cursor or a hybrid render theirs, to feel which
// one Jetty's should become. ⌥⌘F cycles; components/custom/chat_feel/ holds each one.
export const chatFeels = ['jetty', 'capy', 'cursor', 'hybrid'] as const
export type ChatFeel = (typeof chatFeels)[number]
export const chatFeelNames: Record<ChatFeel, string> = {
  jetty: 'Jetty',
  capy: 'Capy',
  cursor: 'Cursor',
  hybrid: 'Hybrid',
}

const key = 'jetty.chatFeel'
const listeners = new Set<() => void>()
let current: ChatFeel = chatFeels.find((feel) => feel === storage.get(key)) ?? 'jetty'
let rootPinned = false

function getChatFeel() {
  return current
}

export function applyChatFeel() {
  document.documentElement.dataset.chatFeel = rootPinned ? 'jetty' : current
}

export function cycleChatFeel() {
  current = chatFeels[(chatFeels.indexOf(current) + 1) % chatFeels.length]!
  storage.set(key, current)
  applyChatFeel()
  for (const listener of listeners) listener()
  return current
}

// While feels render side by side (/dev/feels), the root stays on Jetty, which has no rules, so the
// global feel can't reach into them. Returns the unpin.
export function pinRootChatFeel() {
  rootPinned = true
  applyChatFeel()
  return () => {
    rootPinned = false
    applyChatFeel()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

// A subtree with a feel of its own; its element carries data-chat-feel, so the CSS follows.
export const ChatFeelContext = createContext<ChatFeel | undefined>(undefined)

export const ChatSettledContext = createContext(false)

export type HybridLine = 'today' | '2a' | '2b' | 'both'
export const HybridLineContext = createContext<HybridLine>('today')

export function useHybridLine() {
  return useContext(HybridLineContext)
}

export type BatchTense = 'now' | 'open'
export const BatchTenseContext = createContext<BatchTense>('now')

export function useBatchTense() {
  return useContext(BatchTenseContext)
}

export type HybridPacing = 'none' | 'cursor' | 'jetty'
export const HybridPacingContext = createContext<HybridPacing>('cursor')

export function useHybridPacing() {
  return useContext(HybridPacingContext)
}

export type InterimText = 'today' | 'a' | 'b'
export const InterimTextContext = createContext<InterimText>('b')

export function useInterimText() {
  return useContext(InterimTextContext)
}

export type WorkIndent = 'on' | 'off'
export const WorkIndentContext = createContext<WorkIndent | undefined>(undefined)

export function useWorkIndent() {
  return useContext(WorkIndentContext)
}

export type LiveTurn = 'split' | 'single'
export const LiveTurnContext = createContext<LiveTurn>('split')

export function useLiveTurn() {
  return useContext(LiveTurnContext)
}

export function useChatSettled() {
  return useContext(ChatSettledContext)
}

export function useChatFeel() {
  const scoped = useContext(ChatFeelContext)
  const global = useSyncExternalStore(subscribe, getChatFeel)
  return scoped ?? global
}

export type TenseChange = 'roll' | 'torph'
export const TenseChangeContext = createContext<TenseChange | undefined>(undefined)

export function useTenseChange() {
  return useContext(TenseChangeContext)
}

export type MorphDuration = '150' | '300' | 'default'
export const MorphDurationContext = createContext<MorphDuration>('150')

export function useMorphDuration() {
  return useContext(MorphDurationContext)
}
