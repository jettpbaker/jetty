import { storage } from '@/platform'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

export type ThemeChoice = 'light' | 'dark' | 'system'

const key = 'jetty.theme'
const eventName = 'jetty-theme'

export function loadTheme(): ThemeChoice {
  const saved = storage.get(key)
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark'
}

export function resolvedTheme(choice: ThemeChoice = loadTheme()): 'light' | 'dark' {
  if (choice !== 'system') return choice
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(choice = loadTheme()) {
  document.documentElement.classList.toggle('dark', resolvedTheme(choice) === 'dark')
}

function storeTheme(choice: ThemeChoice) {
  storage.set(key, choice)
  applyTheme(choice)
  window.dispatchEvent(new Event(eventName))
}

let cleanupTimer: ReturnType<typeof setTimeout> | undefined
let active: ViewTransition | undefined
let generation = 0

export function useAnimatedTheme() {
  const [theme, setThemeState] = useState(loadTheme)
  const [resolved, setResolved] = useState(() => resolvedTheme(theme))

  useEffect(() => {
    function sync() {
      const next = loadTheme()
      setThemeState(next)
      setResolved(resolvedTheme(next))
    }
    const media = matchMedia('(prefers-color-scheme: dark)')
    window.addEventListener(eventName, sync)
    media.addEventListener('change', sync)
    return () => {
      window.removeEventListener(eventName, sync)
      media.removeEventListener('change', sync)
    }
  }, [])

  function setTheme(next: string) {
    if (next !== 'light' && next !== 'dark' && next !== 'system') return
    if (next === theme) return
    const current = ++generation
    clearTimeout(cleanupTimer)
    active?.skipTransition()
    const root = document.documentElement
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const apply = () =>
      flushSync(() => {
        storeTheme(next)
        setThemeState(next)
        setResolved(resolvedTheme(next))
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
      void getComputedStyle(root).backgroundColor
      apply()
      cleanupTimer = setTimeout(cleanup, 32)
    }
  }

  return { theme, resolvedTheme: resolved, setTheme }
}
