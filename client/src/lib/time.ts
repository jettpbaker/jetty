const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

export function formatAge(timestamp: number, now: number) {
  const age = now - timestamp
  if (age < minute) return 'now'
  if (age < hour) return `${Math.floor(age / minute)}m`
  if (age < day) return `${Math.floor(age / hour)}h`
  return `${Math.floor(age / day)}d`
}

// The long form timelines use: "5 minutes ago".
export function formatAgo(timestamp: number, now: number) {
  if (Number.isNaN(timestamp)) return ''
  const age = Math.max(0, now - timestamp)
  if (age < minute) return 'just now'
  const [size, unit] = age < hour ? [minute, 'minute'] : age < day ? [hour, 'hour'] : [day, 'day']
  const count = Math.floor(age / size)
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

export function formatDuration(seconds: number) {
  const total = Math.floor(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${total % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
