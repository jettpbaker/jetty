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

// Coarse on purpose: a state that lasts hours shouldn't tick seconds at you.
export function formatElapsed(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / minute))
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function formatDuration(seconds: number) {
  const total = Math.floor(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${total % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayClock = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const fullDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

// When a message was sent: the time today, the day and time this year, the date before that.
export function formatSentAt(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return clock.format(date)
  if (date.getFullYear() === today.getFullYear()) return dayClock.format(date)
  return fullDate.format(date)
}
