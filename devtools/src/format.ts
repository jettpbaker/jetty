export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = ms / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0')

export function formatClock(ts: number, precision: 'minutes' | 'seconds' | 'tenths' = 'seconds') {
  const date = new Date(ts)
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (precision === 'minutes') return hm
  const hms = `${hm}:${pad(date.getSeconds())}`
  return precision === 'tenths' ? `${hms}.${Math.floor(date.getMilliseconds() / 100)}` : hms
}

export function formatDay(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}
