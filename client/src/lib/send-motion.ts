export function getSendMotionTransition() {
  return { type: 'spring' as const, duration: 0.3, bounce: 0 }
}
