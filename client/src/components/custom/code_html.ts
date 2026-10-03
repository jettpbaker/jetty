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

// Whitespace shows no colour, so it joins a neighbouring token instead of costing a span: themes
// that colour spaces apart from the code around them otherwise double a block's DOM.
function foldWhitespace(line: Token[]) {
  const folded: Token[] = []
  let lead = ''
  for (const token of line) {
    const last = folded.at(-1)
    if (token.content.trim() || token.bgColor || token.htmlStyle?.['background-color']) {
      folded.push(lead ? { ...token, content: lead + token.content } : token)
      lead = ''
    } else if (last) folded[folded.length - 1] = { ...last, content: last.content + token.content }
    else lead += token.content
  }
  if (lead) folded.push({ content: lead })
  return folded
}

export function linesHtml(lines: Token[][], numbered: boolean) {
  return lines.map((line) => {
    const empty = line.length === 0 || (line.length === 1 && line[0]!.content === '')
    return `<span class="${numbered ? numberedLineClass : lineClass}">${empty ? '\n' : foldWhitespace(line).map(tokenHtml).join('')}</span>`
  })
}

export function plainHtml(code: string, numbered: boolean) {
  const lines = code
    .split('\n')
    .map((content) => [{ content, color: 'inherit', bgColor: 'transparent', htmlStyle: {} }])
  return linesHtml(lines, numbered)
}
