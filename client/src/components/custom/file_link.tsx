import { createContext, use, type ReactNode } from 'react'
import { toast } from 'sonner'

export type FileTarget = { path: string; line?: number }

// Opens a linked file inside Jetty; false when the file isn't in the thread's project.
export const OpenFileLink = createContext<(target: FileTarget) => boolean>(() => false)

type MarkdownNode = {
  type: string
  url?: string
  children?: MarkdownNode[]
  data?: { hName?: string; hProperties?: Record<string, string> }
}

const scheme = /^[a-z][a-z\d+.-]*:(?!\d)/i
const lineSuffix = /:(\d+)(?::\d+)?$/

export function fileLinkTarget(url: string): FileTarget | undefined {
  const href = url.startsWith('file://') ? url.slice('file://'.length) : url
  if (href.startsWith('#') || href.startsWith('//') || scheme.test(href)) return undefined
  const [encoded = '', hash = ''] = href.split('#', 2)
  let path = encoded
  try {
    path = decodeURIComponent(encoded)
  } catch {
    // A stray % stays literal.
  }
  const suffix = path.match(lineSuffix)
  if (suffix) path = path.slice(0, suffix.index)
  if (path === '') return undefined
  const line = Number(hash.match(/^L(\d+)/)?.[1] ?? suffix?.[1])
  return line > 0 ? { path, line } : { path }
}

// Turns links to files into <file-link>, which rehype's URL hardening leaves alone.
export function remarkFileLinks() {
  function visit(node: MarkdownNode) {
    const target = node.type === 'link' && node.url ? fileLinkTarget(node.url) : undefined
    if (target)
      node.data = {
        ...node.data,
        hName: 'file-link',
        hProperties: { path: target.path, ...(target.line ? { line: String(target.line) } : {}) },
      }
    for (const child of node.children ?? []) visit(child)
  }
  return visit
}

export const fileLinkTag = { 'file-link': ['path', 'line'] }

// A root-relative path inside the project, or undefined when it lies outside.
export function projectRelativePath(path: string, root: string) {
  if (path.startsWith('~')) return undefined
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${root}/${path}`).split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  const resolved = `/${parts.join('/')}`
  const prefix = `${root.replace(/\/+$/, '')}/`
  return resolved.startsWith(prefix) && resolved.length > prefix.length
    ? resolved.slice(prefix.length)
    : undefined
}

export function FileLink({
  path,
  line,
  children,
}: {
  path?: string
  line?: string
  children?: ReactNode
}) {
  const openFile = use(OpenFileLink)
  if (!path) return children
  const target = line ? { path, line: Number(line) } : { path }
  return (
    <button
      type='button'
      title={line ? `${path}:${line}` : path}
      className='cursor-pointer text-left font-mono text-primary underline wrap-anywhere'
      onClick={() => {
        if (openFile(target)) return
        void navigator.clipboard.writeText(path).then(
          () => toast('Path copied', { description: path }),
          () => toast.error("Couldn't copy path")
        )
      }}
    >
      {children}
    </button>
  )
}
