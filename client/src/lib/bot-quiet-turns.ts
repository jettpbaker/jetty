import { isBoolean, useStoredState } from '@/lib/stored-state'

// Settings › Bots › Show check-ins and tidies, per browser.
export function useShowQuietTurns() {
  return useStoredState('jetty.bots.show-quiet-turns', false, isBoolean)
}
