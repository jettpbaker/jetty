type MotionTokens = {
  disclosure: {
    openMs: number
    closeMs: number
    ease: [number, number, number, number]
  }
  rolling: { durationMs: number; ease: string }
  streamFadeMs: number
}

let tokens: MotionTokens | undefined

export function motionMilliseconds(duration: string) {
  return parseFloat(duration) * (duration.trim().endsWith('ms') ? 1 : 1000)
}

// Read after the stylesheet loads, once rather than on each streamed chunk or animation frame.
export function getMotionTokens(): MotionTokens {
  if (tokens) return tokens
  const styles = getComputedStyle(document.documentElement)
  const value = (name: string) => styles.getPropertyValue(`--motion-${name}`).trim()
  const milliseconds = (name: string) => motionMilliseconds(value(name))
  tokens = {
    disclosure: {
      openMs: milliseconds('disclosure-open-duration'),
      closeMs: milliseconds('disclosure-close-duration'),
      ease: value('disclosure-ease').slice('cubic-bezier('.length, -1).split(',').map(Number) as [
        number,
        number,
        number,
        number,
      ],
    },
    rolling: { durationMs: milliseconds('rolling-duration'), ease: value('rolling-ease') },
    streamFadeMs: milliseconds('stream-fade-duration'),
  }
  return tokens
}
