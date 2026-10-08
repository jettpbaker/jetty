import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

type FontOption<T extends string> = { value: T; label: string; family: string }
export type FontSetting<T extends string> = ReturnType<typeof fontSetting<T>>

// One stored font choice, written to a root custom property (--sans or --mono) that the Tailwind
// theme reads; index.css holds the first option as the default for the first paint.
function fontSetting<T extends string>(key: string, property: string, options: FontOption<T>[]) {
  const changeEvent = `${key}-change`
  const family = (value: T) => options.find((option) => option.value === value)!.family
  const fallback = options[0]!.value
  function is(value: unknown): value is T {
    return options.some((option) => option.value === value)
  }
  function load(): T {
    const saved = storage.get(key)
    return is(saved) ? saved : fallback
  }
  function apply(value = load()) {
    document.documentElement.style.setProperty(property, family(value))
  }
  function set(value: T) {
    storage.set(key, value)
    apply(value)
    window.dispatchEvent(new Event(changeEvent))
  }
  // A choice made in another window applies here too.
  function follow() {
    window.addEventListener('storage', (event) => {
      if (event.key !== key) return
      apply()
      window.dispatchEvent(new Event(changeEvent))
    })
  }
  function subscribe(onChange: () => void) {
    window.addEventListener(changeEvent, onChange)
    return () => window.removeEventListener(changeEvent, onChange)
  }
  function use() {
    return useSyncExternalStore(subscribe, load)
  }
  return { options, is, load, apply, set, follow, use, family: () => family(load()) }
}

export const sansFont = fontSetting('jetty.sansFont', '--sans', [
  { value: 'geist', label: 'Geist', family: '"Geist Variable", sans-serif' },
  { value: 'sf', label: 'SF Pro', family: 'system-ui, -apple-system, sans-serif' },
  {
    value: 'instrument',
    label: 'Instrument Sans',
    family: '"Instrument Sans Variable", sans-serif',
  },
])

export const monoFont = fontSetting('jetty.monoFont', '--mono', [
  { value: 'geist', label: 'Geist Mono', family: '"Geist Mono Variable", ui-monospace, monospace' },
  { value: 'paper', label: 'Paper Mono', family: '"Paper Mono", ui-monospace, monospace' },
])
