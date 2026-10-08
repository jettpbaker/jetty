import { storage } from '@/platform'
import { useState } from 'react'

// Settings › Preferences › Use pointer cursors, per browser; index.css reads the attribute.
const key = 'jetty.pointerCursors'

function loadPointerCursors() {
  return storage.get(key) !== 'false'
}

export function applyPointerCursors(on = loadPointerCursors()) {
  document.documentElement.toggleAttribute('data-no-pointer-cursors', !on)
}

export function usePointerCursors() {
  const [on, setOn] = useState(loadPointerCursors)
  function set(next: boolean) {
    setOn(next)
    storage.set(key, String(next))
    applyPointerCursors(next)
  }
  return [on, set] as const
}
