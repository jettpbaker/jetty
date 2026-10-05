import { CodePre } from '@/components/custom/code_block'
import { EntityLink, entityLinkTag, remarkEntityLinks } from '@/components/custom/entity_link'
import { FileLink, fileLinkTag, remarkFileLinks } from '@/components/custom/file_link'
import {
  MarkdownMedia,
  markdownMediaTags,
  rehypeMarkdownMedia,
} from '@/components/custom/markdown_media'
import {
  MarkdownTable,
  MarkdownTableBody,
  MarkdownTableCell,
  MarkdownTableHead,
  MarkdownTableHeader,
  MarkdownTableRow,
} from '@/components/custom/markdown_table'
import { smoothBlocks, wholeWords } from '@/components/custom/smooth_stream'
import { cn } from '@/lib/utils'

import './markdown.css'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { useEffect, useState, type ComponentProps, type ReactElement } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import remarkBreaks from 'remark-breaks'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {
  type BlockProps,
  type ExtraProps,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  type StreamdownProps,
} from 'streamdown'
import 'streamdown/styles.css'
import { unified, type PluggableList } from 'unified'

const remarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkBreaks,
  remarkFileLinks,
  remarkEntityLinks,
]
const allowedTags = { ...fileLinkTag, ...entityLinkTag }
function MarkdownImage({
  node: _node,
  src,
  alt,
  className,
  ...props
}: ComponentProps<'img'> & ExtraProps) {
  const source = src?.replace(
    /^(https:\/\/github\.githubassets\.com\/static\/images\/icons\/copilot-code-review\/(?:medium|low)-v2-light)\.png$/,
    '$1.svg'
  )
  return (
    <img
      {...props}
      src={source}
      alt={alt ?? ''}
      className={cn('inline-block max-w-full align-middle', className)}
    />
  )
}

const components = {
  pre: CodePre,
  img: MarkdownImage,
  table: MarkdownTable,
  thead: MarkdownTableHead,
  tbody: MarkdownTableBody,
  tr: MarkdownTableRow,
  th: MarkdownTableHeader,
  td: MarkdownTableCell,
  code: ({ node: _node, className, children, ...props }: ComponentProps<'code'> & ExtraProps) => (
    <code
      className={cn('inline-code rounded px-1.5 py-0.5 font-mono text-sm', className)}
      data-streamdown='inline-code'
      {...props}
    >
      {children}
    </code>
  ),
  'file-link': FileLink,
  'entity-link': EntityLink,
  'markdown-media': MarkdownMedia,
}
// Links open in a new tab; streamdown's confirm modal is a speed bump with no focus handling.
const linkSafety = { enabled: false }

type SanitizeSchema = { tagNames: string[]; attributes: Record<string, unknown[]> }
const [sanitize, schema] = defaultRehypePlugins.sanitize as [unknown, SanitizeSchema]
// Streamdown ignores allowedTags once the pipeline is custom, so they're listed here too.
const rehypePlugins = [
  defaultRehypePlugins.raw,
  [
    sanitize,
    {
      ...schema,
      tagNames: [
        ...schema.tagNames,
        ...Object.keys(allowedTags),
        ...Object.keys(markdownMediaTags),
      ],
      attributes: { ...schema.attributes, ...allowedTags, ...markdownMediaTags },
    },
  ],
  defaultRehypePlugins.harden,
  rehypeMarkdownMedia,
] as StreamdownProps['rehypePlugins']

// Streamdown parses a block every time it mounts, and a thread switch remounts every message.
// This is its Block render (Streamdown 2.6.0) keeping each tree by text, so a block parses once.
// It skips what the app never sets (dir, indentation normalising, animation, element filters,
// html-to-text without rehype-raw) and the incomplete-fence context only a streaming block needs.
// Re-check it against Streamdown's on upgrade.
function cachedBlock() {
  const trees = new Map<string, ReactElement>()
  let processor: ReturnType<typeof blockProcessor> | undefined
  return function CachedBlock({ content, components, remarkPlugins, rehypePlugins }: BlockProps) {
    processor ??= blockProcessor(remarkPlugins ?? [], rehypePlugins ?? [])
    const tree =
      trees.get(content) ??
      toJsxRuntime(processor.runSync(processor.parse(content), content), {
        Fragment,
        components,
        ignoreInvalidStyle: true,
        jsx,
        jsxs,
        passKeys: true,
        passNode: true,
      })
    trees.delete(content)
    trees.set(content, tree)
    if (trees.size > 1000) trees.delete(trees.keys().next().value!)
    return tree
  }
}

function blockProcessor(remarkPlugins: PluggableList, rehypePlugins: PluggableList) {
  return unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypePlugins)
}

const MarkdownBlock = cachedBlock()

export function Markdown({
  children,
  streaming,
  className = 'text-sm leading-relaxed',
}: {
  children: string
  streaming?: boolean
  className?: string
}) {
  // A message that mounts mid-stream keeps Streamdown's blocks for life, swapping would remount it.
  const [smooth] = useState(() => (streaming ? smoothBlocks(children) : undefined))
  const [BlockComponent] = useState(() => smooth?.SmoothBlock ?? MarkdownBlock)
  useEffect(() => smooth?.mounted(), [smooth])
  return (
    <Streamdown
      className={className}
      components={components}
      allowedTags={allowedTags}
      linkSafety={linkSafety}
      isAnimating={streaming}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      BlockComponent={BlockComponent}
    >
      {smooth && streaming ? wholeWords(children) : children}
    </Streamdown>
  )
}

type TextNode = { type: string; value?: string; lang?: string | null; children?: TextNode[] }

const textParser = unified().use(remarkParse).use(remarkPlugins)
const phrasing = new Set([
  'paragraph',
  'heading',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
  'tableCell',
])

function nodeText(node: TextNode): string {
  if (node.type === 'code') return node.lang === 'suggestion' ? 'Suggested change' : 'Code block'
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  if (node.type === 'break') return ' '
  return (node.children ?? []).map(nodeText).join(phrasing.has(node.type) ? '' : ' ')
}

// One line of plain text for a preview: images and HTML drop out, code blocks become a label.
export function markdownText(markdown: string) {
  return nodeText(textParser.parse(markdown)).replace(/\s+/g, ' ').trim()
}
