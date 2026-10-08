import { createContext, use, type ReactNode } from 'react'
import { toast } from 'sonner'

import { visitLinks, type MarkdownNode } from './markdown_links'

export type FileTarget = { path: string; line?: number }

// Opens a linked file inside Jetty; false when the file isn't in the thread's project.
export const OpenFileLink = createContext<(target: FileTarget) => boolean>(() => false)

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
  return (tree: MarkdownNode) =>
    visitLinks(tree, (node, url) => {
      const target = fileLinkTarget(url)
      if (target)
        node.data = {
          ...node.data,
          hName: 'file-link',
          hProperties: { path: target.path, ...(target.line ? { line: String(target.line) } : {}) },
        }
    })
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

// A file Jetty can't open in place is handed over as its path.
export function copyFilePath(path: string) {
  void navigator.clipboard.writeText(path).then(
    () => toast('Path copied', { description: path }),
    () => toast.error("Couldn't copy path")
  )
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
        if (!openFile(target)) copyFilePath(path)
      }}
    >
      {children}
    </button>
  )
}
