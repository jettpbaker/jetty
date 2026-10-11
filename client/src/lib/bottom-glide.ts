// Follows a pinned list down as it grows on a critically damped spring, so a line added mid-glide
// bends the motion instead of restarting it, and the chat never jumps a whole line at once.
export function bottomGlide(
  element: HTMLElement,
  {
    onWrite,
    onRun,
    target = () => element.scrollHeight - element.clientHeight,
    read = () => element.scrollTop,
    apply = (top: number) => {
      element.scrollTop = top
    },
  }: {
    onWrite?: (top: number) => void
    onRun?: (running: boolean) => void
    target?: () => number
    read?: () => number
    apply?: (top: number) => void
  } = {}
) {
  const stiffness = 20
  let frame = 0
  let velocity = 0
  let previous = 0
  function tick(now: number) {
    const dt = Math.min(0.05, (now - previous) / 1000)
    previous = now
    const bottom = Math.max(0, target())
    const offset = read() - bottom
    const decay = Math.exp(-stiffness * dt)
    const next = (offset + (velocity + stiffness * offset) * dt) * decay
    velocity = (velocity - stiffness * (velocity + stiffness * offset) * dt) * decay
    // scrollTop snaps to whole pixels, so the spring can stall a pixel short of the bottom.
    const settled = Math.abs(offset) <= 1 && Math.abs(velocity) < 10
    write(settled ? bottom : bottom + next)
    frame = settled ? 0 : requestAnimationFrame(tick)
    if (!settled) return
    velocity = 0
    onRun?.(false)
  }
  function write(top: number) {
    apply(top)
    onWrite?.(read())
  }
  return {
    write,
    start() {
      if (frame) return
      previous = performance.now()
      frame = requestAnimationFrame(tick)
      onRun?.(true)
    },
    stop() {
      if (!frame) return
      cancelAnimationFrame(frame)
      frame = 0
      velocity = 0
      onRun?.(false)
    },
  }
}
