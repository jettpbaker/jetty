import type { DiffLineAnnotation, FileDiffMetadata, FileDiffLoadedFiles } from '@pierre/diffs'

import { useResolvedTheme } from '@/lib/theme'
import { FileDiff } from '@pierre/diffs/react'
import { useContext, type ReactNode } from 'react'

import { useDiffWorkerPoolLoading } from '../diff_worker_pool'
import { hugeIconMasks } from '../huge_icons'
import { codeSurfaceCSS, syntaxTheme } from '../syntax_theme'
import { DiffStyleContext, DiffWrapContext } from './model'

// Jetty's skin for Pierre's diffs, injected into its shadow root: the code surface (syntax_theme.ts),
// line numbers tinted like their code with no gap between, so a changed line's tint runs unbroken, and a solid
// removed-line bar like the added one (Pierre stripes it).
// A comment's row is one colour across the gutter and the code: the diff background, or, between two
// added (or two removed) lines, their tint, so a run of changes reads as one block with the comment
// inside it; the gutter bar stays on the lines themselves. In split view the other side's spacer keeps
// the empty side's stripes when it sits inside them. Comments stack
// above the sticky line-number gutter (z-index 3) so their card can reach back over it.
const diffCSS = `
${codeSurfaceCSS}
[data-line-annotation], [data-gutter-buffer="annotation"] { --diffs-annotation-bg: var(--diffs-bg); }
[data-line-annotation] { z-index: 4; }
[data-content-buffer] + [data-line-annotation]:has(+ [data-content-buffer]) {
  background-image: repeating-linear-gradient(-45deg, transparent, transparent calc(3px * 1.414), var(--diffs-bg-buffer) calc(3px * 1.414), var(--diffs-bg-buffer) calc(4px * 1.414));
  background-size: 8px 8px;
  background-position: 5px 0;
  background-origin: border-box;
}
[data-gutter-buffer="buffer"] + [data-gutter-buffer="annotation"]:has(+ [data-gutter-buffer="buffer"]) { --diffs-annotation-bg: var(--diffs-bg-context-gutter); }
[data-gutter] [data-column-number] { --mix-light: 88%; --mix-dark: 80%; }
[data-indicators="bars"] [data-line-type="change-deletion"][data-column-number]::before { background: var(--diffs-deletion-base); }
${(['addition', 'deletion'] as const)
  .map(
    (kind) => `
[data-line-type="change-${kind}"] + :is([data-line-annotation], [data-gutter-buffer="annotation"]):has(+ [data-line-type="change-${kind}"]) { --diffs-annotation-bg: var(--diffs-bg-${kind}); }`
  )
  .join('')}`
// Pierre's fold row as a chip on a hairline, at the left: the arrow says which way it expands (Pierre
// flips its chevron, so an "expand-down" button reveals the lines above). A short run has one button,
// stretched over the row, its arrow drawn in the chip; a run of over 100 lines comes in chunks: arrow
// buttons that show 100 more lines from their end, then the count, which shows the whole run (Pierre's
// Expand all button, laid invisibly over it in the same grid cell).
// Pierre renders each fold in both the gutter and the code column, and in split view on both sides; it
// draws the controls from the gutter of the unified or deletions side and a bare bar elsewhere, so the
// chip is scoped to that gutter and every other copy keeps Pierre's display and gets only the hairline.
const shown = ':is([data-unified], [data-deletions]) [data-gutter]'
const hairline =
  'background: var(--diffs-bg) linear-gradient(var(--border), var(--border)) center / 100% 0.5px no-repeat;'
const chip =
  'display: flex; flex: none; align-items: center; gap: 6px; height: 22px; padding: 0 10px 0 8px; border-radius: 999px; border: 0.5px solid var(--border); background: var(--diffs-bg); color: var(--muted-foreground); font-family: var(--font-sans);'
const arrow =
  'content: ""; width: 12px; height: 12px; background: currentColor; mask: var(--fold-arrow) center / 12px no-repeat;'
const hover =
  'background: color-mix(in oklch, var(--foreground) 6%, var(--diffs-bg)); color: var(--foreground);'
const chunked = `${shown} [data-separator-wrapper]:has([data-expand-all-button])`
const foldCSS = `
[data-separator="line-info"] { margin: 0; height: 32px; background: transparent; }
[data-separator="line-info"] [data-separator-wrapper] { height: 32px; margin: 0; border-radius: 0; ${hairline} }
${shown} [data-separator-wrapper] { display: flex; align-items: center; gap: 4px; width: 100cqi; padding: 0 0 0 8px; }
[data-expand-down], [data-expand-down] + [data-separator-content] { --fold-arrow: ${hugeIconMasks.arrowUp03}; }
[data-expand-up], [data-expand-up] + [data-separator-content] { --fold-arrow: ${hugeIconMasks.arrowDown03}; }
[data-expand-both], [data-expand-both] + [data-separator-content] { --fold-arrow: ${hugeIconMasks.arrowUpDown}; }
${shown} [data-expand-button] { position: absolute; inset: 0; width: auto; height: auto; background: transparent; border-radius: 0; cursor: pointer; }
${shown} [data-expand-button] svg { display: none; }
${shown} [data-separator-content] { ${chip} }
${shown} [data-expand-button] + [data-separator-content]::before { ${arrow} }
[data-unmodified-lines] { color: inherit; }
${shown} [data-separator-content]:hover { text-decoration: none; }
${shown} [data-separator-wrapper]:hover [data-separator-content] { ${hover} }
${chunked} { display: grid; grid-template: none / none; grid-auto-flow: column; grid-auto-columns: max-content; column-gap: 4px; }
${chunked} [data-expand-button] { position: static; grid-row: 1; grid-column: auto; align-self: center; ${chip} }
${chunked} :is([data-separator-content], [data-expand-all-button]) { grid-row: 1; grid-column: 2; }
${chunked}:has([data-expand-up] + [data-expand-down]) :is([data-separator-content], [data-expand-all-button]) { grid-column: 3; }
${chunked} [data-expand-all-button] { z-index: 1; justify-self: stretch; opacity: 0; }
${chunked} [data-expand-button]:not([data-expand-all-button]) { width: 22px; padding: 0; justify-content: center; }
${chunked} [data-expand-button]:not([data-expand-all-button])::before { ${arrow} }
${chunked} [data-separator-content]::before { display: none; }
${chunked}:hover [data-separator-content] { background: var(--diffs-bg); color: var(--muted-foreground); }
${chunked} [data-expand-button]:hover, ${chunked}:has([data-expand-all-button]:hover) [data-separator-content] { ${hover} }
`

export function DiffBody<T = undefined>({
  diff,
  loadDiffFiles,
  suggestion = false,
  snippet = false,
  annotations,
  renderAnnotation,
}: {
  diff: FileDiffMetadata
  loadDiffFiles?: (diff: FileDiffMetadata) => Promise<FileDiffLoadedFiles>
  suggestion?: boolean
  snippet?: boolean
  annotations?: DiffLineAnnotation<T>[]
  renderAnnotation?: (annotation: DiffLineAnnotation<T>) => ReactNode
}) {
  const loading = useDiffWorkerPoolLoading()
  const diffStyle = useContext(DiffStyleContext)
  const wrap = useContext(DiffWrapContext)
  const resolvedTheme = useResolvedTheme()
  if (loading)
    return <div aria-hidden='true' style={{ height: Math.max(40, diff.unifiedLineCount * 20) }} />
  return (
    <FileDiff
      fileDiff={diff}
      lineAnnotations={annotations}
      renderAnnotation={renderAnnotation}
      options={{
        loadDiffFiles,
        diffStyle: suggestion ? 'unified' : diffStyle,
        theme: syntaxTheme,
        themeType: resolvedTheme === 'dark' ? 'dark' : 'light',
        disableFileHeader: true,
        hunkSeparators: snippet || suggestion ? 'simple' : 'line-info',
        overflow: wrap ? 'wrap' : 'scroll',
        unsafeCSS: diffCSS + foldCSS,
      }}
    />
  )
}
