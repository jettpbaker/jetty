import type { AnyRouter } from '@tanstack/react-router'

// Return to the previous in-app url, falling back to home when there is no
// history to go back to (e.g. /settings opened via a direct link).
export function historyBackWithFallback(router: AnyRouter): void {
  if (router.history.canGoBack()) {
    router.history.back()
  } else {
    void router.navigate({ to: '/' })
  }
}
