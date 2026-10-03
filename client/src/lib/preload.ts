import { use } from 'react'

// Code a view loads on demand, started early so the view opens on it. React.lazy and use()
// suspend on a promise they haven't seen even once it has settled, flashing the fallback (which
// React then holds for 300 ms), so a loaded value is read directly.
export function preloadable<T>(load: () => Promise<T>) {
  let loaded: T | undefined
  let loading: Promise<T> | undefined
  function preload() {
    return (loading ??= load().then((value) => (loaded = value)))
  }
  return { preload, useLoaded: () => loaded ?? use(preload()) }
}

// Runs once the browser is idle, after the current frame has painted, and returns a cancel.
// Safari has no requestIdleCallback.
export function whenIdle(callback: () => void) {
  if (typeof requestIdleCallback !== 'function') {
    const timer = setTimeout(callback)
    return () => clearTimeout(timer)
  }
  const handle = requestIdleCallback(callback)
  return () => cancelIdleCallback(handle)
}
