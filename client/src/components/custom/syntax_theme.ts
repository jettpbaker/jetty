import { registerCustomTheme } from '@pierre/diffs'

// Jetty's one syntax theme, Cursor's, for chat code, diffs and the file editor. Its colours load
// with the first highlight.
const themes = () => import('./diff/cursor_themes')
registerCustomTheme('cursor-dark', () => themes().then(({ cursorDark }) => cursorDark))
registerCustomTheme('cursor-light', () => themes().then(({ cursorLight }) => cursorLight))
export const syntaxTheme = { dark: 'cursor-dark', light: 'cursor-light' } as const

// Pierre's code views on Jetty's code surface, with Jetty's status colours for added and removed
// lines instead of the theme's.
export const codeSurfaceCSS =
  ':host { --diffs-font-size: 12px; --diffs-line-height: 20px; --diffs-bg: var(--diff-surface) !important; --diffs-addition-color-override: var(--status-success); --diffs-deletion-color-override: var(--status-error); --diffs-gap-style: none; }'

// Pierre draws the unmodified-lines expanders as icon-only buttons with no name.
export function nameExpanders(node: HTMLElement) {
  for (const button of node.shadowRoot?.querySelectorAll<HTMLElement>(
    '[data-expand-button]:not([data-expand-all-button])'
  ) ?? []) {
    const { expandUp, expandDown } = button.dataset
    const way = expandUp !== undefined ? ' above' : expandDown !== undefined ? ' below' : ''
    button.setAttribute('aria-label', `Show unmodified lines${way}`)
  }
}
