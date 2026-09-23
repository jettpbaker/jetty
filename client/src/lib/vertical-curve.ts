export type CurveSettings = {
  curveStart: number
  curveStrength: number
}

export function curveProgressAt(position: number, settings: CurveSettings) {
  if (position <= settings.curveStart || settings.curveStart >= 1) return position
  const remaining = 1 - settings.curveStart
  const t = (position - settings.curveStart) / remaining
  const curved = 1 - (1 - t) * Math.exp(-settings.curveStrength * t * t)
  return settings.curveStart + remaining * curved
}

export function curveMask(settings: CurveSettings, top: number, bottom: number) {
  const positions = [0]
  for (let step = 0; step <= 64; step++) {
    positions.push(settings.curveStart + ((1 - settings.curveStart) * step) / 64)
  }
  const stops = positions.map((position) => {
    const opacity = top + (bottom - top) * curveProgressAt(position, settings)
    return `rgb(0 0 0 / ${opacity.toFixed(5)}) ${position * 100}%`
  })
  return `linear-gradient(to bottom, ${stops.join(', ')})`
}
