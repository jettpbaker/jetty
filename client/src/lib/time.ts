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

const clock = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})
const dayClock = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})
const fullDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

// A quiet stretch this long starts a new session in a chat, under its own stamp.
export const SESSION_GAP = 30 * minute

// A chat's session stamp: "Today 2:41 pm", "Yesterday 9:05 am", "Monday 4:30 pm".
export function chatStamp(at: number, now: number) {
  const date = new Date(at)
  const days = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000
  )
  const day =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Yesterday'
        : date.toLocaleDateString('en-AU', { weekday: 'long' })
  return `${day} ${date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
}

// When a message was sent: the time today, the day and time this year, the date before that.
export function formatSentAt(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return clock.format(date)
  if (date.getFullYear() === today.getFullYear()) return dayClock.format(date)
  return fullDate.format(date)
}
