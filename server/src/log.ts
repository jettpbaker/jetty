/** Timestamped, area-tagged stdout log — keep lines single and grep-friendly. */
export function slog(area: string, message: string) {
  console.log(`${new Date().toISOString()} [${area}] ${message}`)
}
