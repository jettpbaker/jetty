import { storage } from '@/platform'
import { useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

type ThemeChoice = 'light' | 'dark' | 'system'

const key = 'jetty.theme'

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

function loadTheme(): ThemeChoice {
  const saved = storage.get(key)
  return isThemeChoice(saved) ? saved : 'dark'
}

function resolvedTheme(choice: ThemeChoice) {
  if (choice !== 'system') return choice
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(choice = loadTheme()) {
  document.documentElement.classList.toggle('dark', resolvedTheme(choice) === 'dark')
}

let cleanupTimer: ReturnType<typeof setTimeout> | undefined
let active: ViewTransition | undefined
let generation = 0

export function useAnimatedTheme() {
  const [theme, setThemeState] = useState(loadTheme)

  function setTheme(next: unknown) {
    if (!isThemeChoice(next) || next === theme) return
    const current = ++generation
    clearTimeout(cleanupTimer)
    active?.skipTransition()
    const root = document.documentElement
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const apply = () =>
      flushSync(() => {
        storage.set(key, next)
        applyTheme(next)
        setThemeState(next)
      })
    const cleanup = () => {
      if (current === generation) {
        delete root.dataset.themeTransition
        active = undefined
      }
    }
    if (!reducedMotion && document.startViewTransition) {
      root.dataset.themeTransition = 'crossfade'
      active = document.startViewTransition(apply)
      void active.finished.catch(() => {}).finally(cleanup)
    } else {
      root.dataset.themeTransition = 'off'
      // Flush styles so transitions are disabled before the theme class flips.
      void getComputedStyle(root).backgroundColor
      apply()
      cleanupTimer = setTimeout(cleanup, 32)
    }
  }

  return { theme, setTheme }
}

function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributeFilter: ['class'] })
  return () => observer.disconnect()
}

function themeClass() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function useResolvedTheme() {
  return useSyncExternalStore(subscribeToThemeClass, themeClass)
}
