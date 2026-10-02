// Maps positions in a lab build's chunks back to source through its hidden sourcemaps.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SourceMapConsumer } from 'source-map-js'

export type Location = { source: string; line: number; name: string }

export type SourceMapper = {
  locate(file: string, offset: number, fallbackName: string): Location
  // 0-based line and column, as V8 call frames report them.
  locateFrame(file: string, line: number, column: number, fallbackName: string): Location
}

type Chunk = { text: string; lineStarts: number[]; map: SourceMapConsumer | null }

export function createSourceMapper(distDir: string): SourceMapper {
  const chunks = new Map<string, Chunk | null>()
  const memo = new Map<string, Location>()

  function chunk(file: string) {
    if (chunks.has(file)) return chunks.get(file)!
    const path = join(distDir, file)
    let loaded: Chunk | null = null
    if (file.endsWith('.js') && existsSync(path)) {
      const text = readFileSync(path, 'utf8')
      const lineStarts = [0]
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
      const mapPath = `${path}.map`
      loaded = {
        text,
        lineStarts,
        map: existsSync(mapPath)
          ? new SourceMapConsumer(JSON.parse(readFileSync(mapPath, 'utf8')))
          : null,
      }
    }
    chunks.set(file, loaded)
    return loaded
  }

  function locateLine(file: string, line: number, column: number, fallbackName: string) {
    const key = `${file}:${line}:${column}`
    const hit = memo.get(key)
    if (hit) return hit
    const map = chunk(file)?.map
    const original = map?.originalPositionFor({ line: line + 1, column })
    const location = original?.source
      ? {
          source: cleanSource(original.source),
          line: original.line ?? 0,
          name: original.name ?? (fallbackName || '(anonymous)'),
        }
      : { source: file, line: line + 1, name: fallbackName || '(anonymous)' }
    memo.set(key, location)
    return location
  }

  // V8 reports a function's minified name; the sourcemap names it where that identifier
  // appears, just after the function's start.
  function locate(file: string, offset: number, fallbackName: string): Location {
    const loaded = chunk(file)
    if (!loaded) return { source: file, line: 0, name: fallbackName || '(anonymous)' }
    if (fallbackName) {
      const at = loaded.text.indexOf(fallbackName, offset)
      if (at >= 0 && at - offset < 64) offset = at
    }
    const starts = loaded.lineStarts
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return locateLine(file, lo, offset - starts[lo]!, fallbackName)
  }

  function locateFrame(file: string, line: number, column: number, fallbackName: string) {
    const start = chunk(file)?.lineStarts[line]
    return start === undefined
      ? { source: file, line: line + 1, name: fallbackName || '(anonymous)' }
      : locate(file, start + column, fallbackName)
  }

  return { locate, locateFrame }
}

// "../../node_modules/.bun/react-dom@19.2.8/node_modules/react-dom/cjs/x.js" → "react-dom/cjs/x.js",
// "../src/state/threads.ts" → "src/state/threads.ts".
function cleanSource(source: string) {
  const modules = source.lastIndexOf('node_modules/')
  if (modules >= 0) return source.slice(modules + 'node_modules/'.length)
  return source.replace(/^(\.\.\/)+/, '').replace(/^client\//, '')
}
