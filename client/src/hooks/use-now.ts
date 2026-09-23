import { useEffect, useState } from 'react'

export function useNow(interval: number, enabled = true) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [enabled, interval])
  return now
}
