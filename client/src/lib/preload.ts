// Code a view loads on demand, started early so the view opens on it.
export function preloadable<T>(load: () => Promise<T>) {
  let loaded: { value: T } | undefined
  let failed: { error: unknown } | undefined
  let loading: Promise<T> | undefined
  function preload() {
    return (loading ??= load().then(
      (value) => {
        loaded = { value }
        return value
      },
      (error: unknown) => {
        failed = { error }
        throw error
      }
    ))
  }
  function useLoaded() {
    if (failed) throw failed.error
    if (!loaded) throw preload()
    return loaded.value
  }
  return { preload, useLoaded }
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
