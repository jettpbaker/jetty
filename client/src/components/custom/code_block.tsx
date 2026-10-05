import { cachedHtml, highlightHtml } from '@/components/custom/code_highlight'
import { plainHtml } from '@/components/custom/code_html'

import './code_block.css'
import { CopyButton } from '@/components/custom/copy_button'
import { TextWrapIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
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
import { StreamdownContext } from 'streamdown'

type HastText = { value?: string; children?: HastText[] }

type CodeProps = {
  className?: string
  children?: ReactNode
  node?: { tagName: string; properties?: { metastring?: unknown }; children?: HastText[] }
  metastring?: string
  'data-block'?: string
}

// Raw HTML like <pre><code>a<b>b</b></code></pre> leaves elements inside the code; its text is the code.
function hastText(node: HastText): string {
  return node.value ?? (node.children ?? []).map(hastText).join('')
}

const shellLangs = new Set(['bash', 'sh', 'shell', 'zsh', 'console'])
const well =
  '[--code-surface:color-mix(in_oklch,var(--muted)_60%,var(--background))] bg-(--code-surface)'

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
function usePatchedLines(html: readonly string[], command: boolean) {
  const code = useRef<HTMLElement>(null)
  const shownElement = useRef<HTMLElement | null>(null)
  const shown = useRef(html)
  const [mounted] = useState(() => ({ __html: html.join('') }))
  useLayoutEffect(() => {
    const element = code.current
    const previous = shown.current
    shown.current = html
    if (!element) return
    const remounted = shownElement.current !== null && shownElement.current !== element
    shownElement.current = element
    if (remounted) {
      element.innerHTML = html.join('')
      return
    }
    if (previous === html) return
    let same = 0
    while (same < html.length && previous[same] === html[same]) same++
    if (same === 0) {
      element.innerHTML = html.join('')
      return
    }
    while (element.childNodes.length > same) element.lastChild!.remove()
    if (same < html.length) element.insertAdjacentHTML('beforeend', html.slice(same).join(''))
  }, [html, command])
  return [code, mounted] as const
}

// A capped block follows its streaming end unless the reader has scrolled up in it.
function useFollowEnd(streaming: boolean, capped: boolean, html: readonly string[]) {
  const body = useRef<HTMLPreElement>(null)
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

function WorkerCodeBlock({
  className,
  code,
  meta: _meta,
  ...rest
}: {
  className?: string
  code: string
  meta: string
  metastring?: string
}) {
  const { codeBlockMaxHeight, isAnimating } = useContext(StreamdownContext)
  const language = className?.match(/language-([^\s]+)/)?.[1] ?? ''
  const [wrapped, setWrapped] = useState(false)
  const wrapButton = (
    <Button
      variant='ghost'
      size='icon-xs'
      tone='muted'
      aria-label='Wrap lines'
      aria-pressed={wrapped}
      onClick={() => setWrapped((value) => !value)}
    >
      <TextWrapIcon />
    </Button>
  )
  const numbered = false
  const html = useHighlightedHtml(code.replace(/\n+$/, ''), language, numbered)
  const capped = Boolean(codeBlockMaxHeight)
  const command = shellLangs.has(language) && !code.trimEnd().includes('\n')
  const body = useFollowEnd(isAnimating, capped && !command, html)
  const [lines, mounted] = usePatchedLines(html, command)
  const content = <code className='font-mono' ref={lines} dangerouslySetInnerHTML={mounted} />
  if (command)
    return (
      <div
        className={cn(
          'my-3 flex min-h-9 items-center gap-2 rounded-md py-1.5 pr-1 pl-3 text-xs',
          well
        )}
      >
        <span aria-hidden className='font-mono text-faint-foreground select-none'>
          $
        </span>
        <pre
          className={cn(
            'scrollbar-subtle min-w-0 flex-1 overflow-x-auto',
            wrapped && 'whitespace-pre-wrap wrap-anywhere'
          )}
        >
          {content}
        </pre>
        {wrapButton}
        <CopyButton text={code} label='Copy code' />
      </div>
    )
  return (
    <CodeWell
      copy={
        <>
          {wrapButton}
          <CopyButton text={code} label='Copy code' />
        </>
      }
    >
      <pre
        ref={body}
        className={cn(
          'scrollbar-subtle overflow-x-auto px-3 py-2.5 text-xs leading-5',
          capped && 'overflow-y-auto',
          wrapped && 'whitespace-pre-wrap wrap-anywhere'
        )}
        style={bodyStyle(codeBlockMaxHeight, html.length, isAnimating)}
        {...rest}
      >
        {content}
      </pre>
    </CodeWell>
  )
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return <WorkerCodeBlock code={code} className={`language-${lang}`} meta='' />
}

export function CodePre({ children }: { children?: ReactNode }) {
  if (!isValidElement<CodeProps>(children)) return children
  const { className, children: code, node, ...rest } = children.props
  if (node?.tagName !== 'code') return cloneElement(children, { 'data-block': 'true' })
  const meta = node.properties?.metastring
  return (
    <WorkerCodeBlock
      {...rest}
      className={className}
      code={typeof code === 'string' ? code : hastText(node)}
      meta={typeof meta === 'string' ? meta : ''}
    />
  )
}

// The well and hover corner on their own, for the description editor's editable code block.
export function CodeWell({
  copy,
  className,
  children,
}: {
  copy: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('group/code relative my-3 rounded-md', well, className)}>
      {children}
      <div
        contentEditable={false}
        className='absolute top-0 right-0 flex gap-0.5 rounded-tr-md bg-(--code-surface) p-1.5 opacity-0 transition-opacity group-focus-within/code:opacity-100 group-hover/code:opacity-100 before:absolute before:inset-y-0 before:right-full before:w-6 before:bg-linear-to-r before:from-transparent before:to-(--code-surface)'
      >
        {copy}
      </div>
    </div>
  )
}
