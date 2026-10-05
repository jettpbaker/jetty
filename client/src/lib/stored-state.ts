import { storage } from '@/platform'
import { useState, type SetStateAction } from 'react'

// A per-browser preference: read once when the component mounts, saved on every change.
export function useStoredState<T>(key: string, fallback: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved: unknown = JSON.parse(storage.get(key) ?? 'null')
      return valid(saved) ? saved : fallback
    } catch {
      return fallback
    }
  })
  function set(next: SetStateAction<T>) {
    setValue((current) => {
      const resolved = next instanceof Function ? next(current) : next
      storage.set(key, JSON.stringify(resolved))
      return resolved
    })
  }
  return [value, set] as const
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}
