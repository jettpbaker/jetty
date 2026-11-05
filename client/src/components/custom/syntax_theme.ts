import { registerCustomTheme } from '@pierre/diffs'

// Jetty's one syntax theme, VS Code's 2026, for chat code, diffs and the file editor. Its colours
// load with the first highlight.
const themes = () => import('./diff/vscode_themes')
registerCustomTheme('vscode-2026-dark', () => themes().then(({ vscodeDark }) => vscodeDark))
registerCustomTheme('vscode-2026-light', () => themes().then(({ vscodeLight }) => vscodeLight))
export const syntaxTheme = { dark: 'vscode-2026-dark', light: 'vscode-2026-light' } as const

// Pierre's code views on Jetty's code surface: the app's mono font, and Jetty's status colours for
// added and removed lines instead of the theme's.
export const codeSurfaceCSS = `
:host {
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: var(--text-xs);
  --diffs-line-height: 20px;
  --diffs-bg: var(--diff-surface) !important;
  --diffs-addition-color-override: var(--status-success);
  --diffs-deletion-color-override: var(--status-error);
  --diffs-bg-addition: color-mix(in lab, var(--diffs-bg) 92%, var(--diffs-addition-base));
  --diffs-bg-deletion: color-mix(in lab, var(--diffs-bg) 92%, var(--diffs-deletion-base));
  --diffs-gap-style: none;
}
[data-expand-button]:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
[data-gutter] [data-column-number] { --mix-light: 100%; --mix-dark: 100%; color: var(--muted-foreground); }
[data-background] :is([data-line], [data-no-newline]) {
  --mix-light: 92%;
  --mix-dark: 92%;
}
`

function activateExpander(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  const activate = event.key === 'Enter' ? event.type === 'keydown' : event.type === 'keyup'
  if (!activate || event.repeat) return
  const target = event.currentTarget
  if (target instanceof HTMLElement)
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, shiftKey: event.shiftKey })
    )
}

// Pierre's role=button divs need names, keyboard stops and activation.
export function nameExpanders(node: HTMLElement) {
  for (const button of node.shadowRoot?.querySelectorAll<HTMLElement>('[data-expand-button]') ??
    []) {
    button.tabIndex = 0
    button.onkeydown = activateExpander
    button.onkeyup = activateExpander
    if (button.hasAttribute('data-expand-all-button')) {
      button.setAttribute('aria-label', 'Show all unmodified lines')
      continue
    }
    const { expandUp, expandDown } = button.dataset
    const way = expandUp !== undefined ? ' above' : expandDown !== undefined ? ' below' : ''
    button.setAttribute('aria-label', `Show unmodified lines${way}`)
  }
}
