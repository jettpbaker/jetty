import type { BackgroundTask } from '@jetty/shared/wire'

export function monitoringElapsed(tasks: readonly BackgroundTask[], now: number) {
  const minutes = Math.max(
    0,
    Math.floor((now - Math.min(...tasks.map((task) => task.startedAt))) / 60_000)
  )
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
