import { cachedHtml, highlightHtml } from '@/components/custom/code_highlight'
import { plainHtml } from '@/components/custom/code_html'
import { cn } from '@/lib/utils'
import {
  cloneElement,
  isValidElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  CodeBlockContainer,
  CodeBlockCopyButton,
  CodeBlockDownloadButton,
  CodeBlockHeader,
  StreamdownContext,
  useIsCodeFenceIncomplete,
} from 'streamdown'

type CodeProps = {
  className?: string
  children?: ReactNode
  node?: { tagName: string; properties?: { metastring?: unknown } }
  metastring?: string
  'data-block'?: string
}

// Streamdown sets these and then shiki's colours, which are invalid there and never apply.
const preStyle = { '--sdm-bg': 'transparent', '--sdm-fg': 'inherit' } as CSSProperties
// Streamdown skips an off-screen block (content-visibility: auto) as a 200 px guess, so the thread
// list measured it short and it grew on screen. Here only the body of a block sure to reach its cap
// (every line is at least 20 px) is skipped, as a placeholder exactly the cap's height. Never while
// streaming: skipping resets the body's scroll, which stops it following the end.
const containerStyle = { contentVisibility: 'visible', contain: 'content' } as const

function bodyStyle(
  maxHeight: number | string,
  lines: number,
  streaming: boolean
): CSSProperties | undefined {
  if (!maxHeight) return undefined
  if (streaming || typeof maxHeight === 'string' || lines * 20 < maxHeight) return { maxHeight }
  return { maxHeight, contentVisibility: 'auto', containIntrinsicHeight: `${maxHeight}px` }
}

// Streamdown's code block, starting from the cached highlight so a revisit renders once.
function useHighlightedHtml(code: string, language: string, numbered: boolean) {
  const [html, setHtml] = useState(
    () => cachedHtml(code, language, numbered) ?? plainHtml(code, numbered)
  )
  useEffect(() => {
    let live = true
    const cached = highlightHtml(code, language, numbered, (next) => {
      if (live) setHtml(next ?? plainHtml(code, numbered))
    })
    if (cached !== undefined) setHtml(cached)
    return () => {
      live = false
    }
  }, [code, language, numbered])
  return html
}

// A block mounts with its lines in one innerHTML. Later results replace only the lines from the
// first changed one, so a selection above a streaming end survives it.
function usePatchedLines(html: readonly string[]) {
  const code = useRef<HTMLElement>(null)
  const shown = useRef(html)
  const [mounted] = useState(() => ({ __html: html.join('') }))
  useLayoutEffect(() => {
    const element = code.current
    const previous = shown.current
    shown.current = html
    if (!element || previous === html) return
    let same = 0
    while (same < html.length && previous[same] === html[same]) same++
    if (same === 0) {
      element.innerHTML = html.join('')
      return
    }
    while (element.childNodes.length > same) element.lastChild!.remove()
    if (same < html.length) element.insertAdjacentHTML('beforeend', html.slice(same).join(''))
  }, [html])
  return [code, mounted] as const
}

// A capped block follows its streaming end unless the reader has scrolled up in it.
function useFollowEnd(streaming: boolean, capped: boolean, html: readonly string[]) {
  const body = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  useEffect(() => {
    const element = body.current
    if (!element || !capped) return
    const onScroll = () => {
      atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [capped])
  useEffect(() => {
    atEnd.current = true
  }, [streaming])
  useEffect(() => {
    const element = body.current
    if (element && capped && streaming && atEnd.current)
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' })
  }, [streaming, capped, html])
  return body
}

// Mirrors Streamdown 2.6.0's code block body (markup, classes, follow-to-end), so it can paint from
// cached HTML. Re-check it against Streamdown's on upgrade.
function CodeBlock({
  className,
  code,
  meta,
  ...rest
}: {
  className?: string
  code: string
  meta: string
  metastring?: string
}) {
  const { codeBlockMaxHeight, isAnimating } = useContext(StreamdownContext)
  const language = className?.match(/language-([^\s]+)/)?.[1] ?? ''
  const startLine = Number(meta.match(/startLine=(\d+)/)?.[1] ?? 1)
  const numbered = !/\bnoLineNumbers\b/.test(meta)
  const incomplete = useIsCodeFenceIncomplete()
  const html = useHighlightedHtml(code.replace(/\n+$/, ''), language, numbered)
  const capped = Boolean(codeBlockMaxHeight)
  const body = useFollowEnd(isAnimating, capped, html)
  const [lines, mounted] = usePatchedLines(html)
  return (
    <CodeBlockContainer
      dir='ltr'
      isIncomplete={incomplete}
      language={language}
      style={containerStyle}
    >
      <CodeBlockHeader language={language} />
      <div className='pointer-events-none sticky top-2 z-10 -mt-10 flex h-8 items-center justify-end'>
        <div
          className='pointer-events-auto flex shrink-0 items-center gap-2 rounded-md border border-sidebar bg-sidebar/80 px-1.5 py-1 supports-[backdrop-filter]:bg-sidebar/70 supports-[backdrop-filter]:backdrop-blur'
          data-streamdown='code-block-actions'
        >
          <CodeBlockDownloadButton code={code} language={language} />
          <CodeBlockCopyButton code={code} />
        </div>
      </div>
      <div
        ref={body}
        className={cn(
          className,
          capped && 'overflow-y-auto',
          'overflow-x-auto rounded-md border border-border bg-background p-4 text-sm'
        )}
        data-language={language}
        data-streamdown='code-block-body'
        style={bodyStyle(codeBlockMaxHeight, html.length, isAnimating)}
        {...rest}
      >
        <pre
          className={cn(
            className,
            'bg-[var(--sdm-bg,inherit)] dark:bg-[var(--shiki-dark-bg,var(--sdm-bg,inherit))]'
          )}
          style={preStyle}
        >
          <code
            ref={lines}
            className={numbered ? '[counter-increment:line_0] [counter-reset:line]' : undefined}
            style={
              numbered && startLine > 1 ? { counterReset: `line ${startLine - 1}` } : undefined
            }
            dangerouslySetInnerHTML={mounted}
          />
        </pre>
      </div>
    </CodeBlockContainer>
  )
}

export function CodePre({ children }: { children?: ReactNode }) {
  if (!isValidElement<CodeProps>(children)) return children
  const { className, children: code, node, ...rest } = children.props
  if (node?.tagName !== 'code') return cloneElement(children, { 'data-block': 'true' })
  const meta = node.properties?.metastring
  return (
    <CodeBlock
      {...rest}
      className={className}
      code={typeof code === 'string' ? code : ''}
      meta={typeof meta === 'string' ? meta : ''}
    />
  )
}
