import type { resolveLanguage } from '@/lib/shiki-langs'
import type { ThemedToken } from 'shiki/core'

// A code block's lines in Streamdown's markup, serialised once so showing it again is one
// innerHTML instead of a React element per token. Kept per line, so streaming rewrites only the
// lines that changed.
export type HighlightRequest = {
  key: string
  code: string
  lang: ReturnType<typeof resolveLanguage>
  numbered: boolean
}

type Token = Pick<ThemedToken, 'content' | 'color' | 'bgColor' | 'htmlStyle'>

const lineClass = 'block'
const numberedLineClass =
  'block before:content-[counter(line)] before:inline-block before:[counter-increment:line] before:w-6 before:mr-4 before:text-[13px] before:text-right before:text-muted-foreground/50 before:font-mono before:select-none'
const tokenClass = 'text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]'
const tokenBackgroundClass = 'bg-[var(--sdm-tbg)] dark:bg-[var(--shiki-dark-bg,var(--sdm-tbg))]'

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function tokenHtml(token: Token) {
  const style: Record<string, string> = {}
  let background = Boolean(token.bgColor)
  if (token.color) style['--sdm-c'] = token.color
  if (token.bgColor) style['--sdm-tbg'] = token.bgColor
  for (const [name, value] of Object.entries(token.htmlStyle ?? {})) {
    if (name === 'color') style['--sdm-c'] = value
    else if (name === 'background-color') {
      style['--sdm-tbg'] = value
      background = true
    } else style[name] = value
  }
  const css = Object.entries(style)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  const className = background ? `${tokenClass} ${tokenBackgroundClass}` : tokenClass
  const styleAttribute = css ? ` style="${escapeHtml(css)}"` : ''
  return `<span class="${className}"${styleAttribute}>${escapeHtml(token.content)}</span>`
}

export function linesHtml(lines: Token[][], numbered: boolean) {
  return lines.map((line) => {
    const empty = line.length === 0 || (line.length === 1 && line[0]!.content === '')
    return `<span class="${numbered ? numberedLineClass : lineClass}">${empty ? '\n' : line.map(tokenHtml).join('')}</span>`
  })
}

export function plainHtml(code: string, numbered: boolean) {
  const lines = code
    .split('\n')
    .map((content) => [{ content, color: 'inherit', bgColor: 'transparent', htmlStyle: {} }])
  return linesHtml(lines, numbered)
}
