import type { ChildReport, ThreadItem } from '@jetty/shared/items'

export type ThreadMarker = Extract<ThreadItem, { kind: 'thread_marker' }>

function runsBy<T>(items: readonly T[], key: (item: T) => string) {
  const runs: T[][] = []
  for (const item of items) {
    const last = runs.at(-1)
    if (last && key(last[0]!) === key(item)) last.push(item)
    else runs.push([item])
  }
  return runs
}

export function markerRuns(markers: readonly ThreadMarker[]) {
  return runsBy(markers, (marker) => marker.action)
}

export function reportRuns(reports: readonly ChildReport[]) {
  const latest = new Map(reports.map((report, index) => [report.threadId, index]))
  return runsBy(
    reports.filter((report, index) => latest.get(report.threadId) === index),
    (report) => report.outcome
  )
}

export function botMarkerHeight(lines: number) {
  return Math.max(0, 24 * lines - 4)
}
