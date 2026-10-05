// The server's clock, carried on from the time on its last snapshot by this page's monotonic clock,
// so a browser whose own clock is off (another Mac over Tailscale) still reads server timestamps
// right, and a wall clock that jumps doesn't move it.
let anchor: { server: number; local: number } | undefined

export function observeServerTime(server: number) {
  anchor = { server, local: performance.now() }
}

export function serverNow() {
  return anchor ? anchor.server + performance.now() - anchor.local : Date.now()
}
