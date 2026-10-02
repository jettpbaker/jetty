import { cachedHtml, highlightHtml } from '@/components/custom/code_highlight'
import { plainHtml } from '@/components/custom/code_html'
import { cn } from '@/lib/utils'
import {
  cloneElement,
  isValidElement,
  useContext,
  useEffect,
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

// Streamdown's code block, starting from the cached highlight so a revisit renders once.
function useHighlightedHtml(code: string, language: string, numbered: boolean) {
  const [html, setHtml] = useState(
    () => cachedHtml(code, language, numbered) ?? plainHtml(code, numbered)
  )
  useEffect(() => {
    let live = true
    const cached = highlightHtml(code, language, numbered, (next) => {
      if (live) setHtml(next)
    })
    if (cached !== undefined) setHtml(cached)
    return () => {
      live = false
    }
  }, [code, language, numbered])
  return html
}

// A capped block follows its streaming end unless the reader has scrolled up in it.
function useFollowEnd(streaming: boolean, capped: boolean, html: string) {
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
  return (
    <CodeBlockContainer dir='ltr' isIncomplete={incomplete} language={language}>
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
        style={capped ? { maxHeight: codeBlockMaxHeight } : undefined}
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
            className={numbered ? '[counter-increment:line_0] [counter-reset:line]' : undefined}
            style={
              numbered && startLine > 1 ? { counterReset: `line ${startLine - 1}` } : undefined
            }
            dangerouslySetInnerHTML={{ __html: html }}
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
