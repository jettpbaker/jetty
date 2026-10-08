const MINUTE = 60_000

export type BotLifecycle = {
  turnEndedAt?: number
  checkedInAt?: number
  compactRetryAt?: number
  tidiedAt?: number
  tidiedHead?: string
  tidyRetryAt?: number
}

function readTiming() {
  const timing = {
    checkInMs: {
      claude: { ms: 55 * MINUTE, requiresItems: false },
      codex: { ms: 25 * MINUTE, requiresItems: false },
      grok: { ms: 55 * MINUTE, requiresItems: true },
    },
    userActiveMs: 3 * 60 * MINUTE,
    workerStaleMs: 30 * MINUTE,
    awayIdleMs: 5 * MINUTE,
    compactAt: 0.5,
    compactUnskippableAt: 0.85,
    tidyEveryMs: 24 * 60 * MINUTE,
    retryMs: 30 * MINUTE,
    tickMs: 5_000,
  }
  try {
    const overrides: unknown = JSON.parse(process.env.JETTY_BOT_TIMING ?? '{}')
    if (!overrides || typeof overrides !== 'object') return timing
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
      if (key === 'checkInMs') {
        for (const provider of Object.values(timing.checkInMs)) provider.ms = value
      } else if (Object.hasOwn(timing, key)) {
        timing[key as Exclude<keyof typeof timing, 'checkInMs'>] = value
      }
    }
  } catch {}
  return timing
}

export const botTiming = readTiming()
