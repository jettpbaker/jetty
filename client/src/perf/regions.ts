export function regionOf(node: Node | null | undefined) {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest('[data-perf-region]')?.getAttribute('data-perf-region') ?? 'none'
}
