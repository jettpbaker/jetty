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
