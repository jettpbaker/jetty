import { streamFeels } from '@/components/custom/chat_feel'
import { CodePre } from '@/components/custom/code_block'
import { EntityLink, entityLinkTag, remarkEntityLinks } from '@/components/custom/entity_link'
import { FileLink, fileLinkTag, remarkFileLinks } from '@/components/custom/file_link'
import { blocksWithDefinitions, type MarkdownNode } from '@/components/custom/markdown_links'
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
import { replyShown, usePacedText, useReplyShown } from '@/components/custom/smooth_stream'
import { useChatFeel, useChatSettled, useHybridPacing } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'

import './markdown.css'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { useEffect, useRef, useState, type ComponentProps, type ReactElement } from 'react'
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
import { unified, type PluggableList, type Processor } from 'unified'

const allowedTags = { ...fileLinkTag, ...entityLinkTag }
const internalTag = new RegExp(`<(?=/?(?:${Object.keys(allowedTags).join('|')}))`, 'gi')

// Agents write `<placeholder>` in prose, so their text never parses HTML: tags show as typed.
function remarkLiteralHtml(this: Processor) {
  const extensions = this.data('micromarkExtensions') ?? []
  this.data('micromarkExtensions', [...extensions, { disable: { null: ['htmlFlow', 'htmlText'] } }])
}

// GitHub bodies keep their HTML (images, details), but only Jetty makes these tags, from links:
// one an author writes shows as text, as GFM does disallowed HTML, rather than pass for Jetty's own.
function remarkEscapeInternalTags() {
  function visit(node: MarkdownNode) {
    if (node.type === 'html') node.value = node.value?.replace(internalTag, '&lt;')
    for (const child of node.children ?? []) visit(child)
  }
  return visit
}

// Tight lists drop paragraph wrappers; a later blank line makes them loose and remounts the
// text already shown. Keep the paragraph structure from the start (list paragraphs are inline).
function remarkStableLists() {
  function visit(node: MarkdownNode & { spread?: boolean }) {
    if (node.type === 'list' || node.type === 'listItem') node.spread = true
    for (const child of node.children ?? []) visit(child)
  }
  return visit
}

const sharedRemarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkStableLists,
  remarkBreaks,
  remarkFileLinks,
  remarkEntityLinks,
]
const remarkPlugins = [remarkLiteralHtml, ...sharedRemarkPlugins]
const htmlRemarkPlugins = [remarkEscapeInternalTags, ...sharedRemarkPlugins]

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
      // One token (a flag, a path) that a table keeps whole; 50 characters still fit a 24rem cell.
      data-token={typeof children === 'string' && /^\S{1,50}$/.test(children) ? '' : undefined}
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

type HastNode = { tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] }

// Footnote links jump within the message; streamdown would open them in a new tab like any link.
function rehypeLocalLinks() {
  function visit(node: HastNode) {
    const href = node.properties?.href
    if (node.tagName === 'a' && typeof href === 'string' && href.startsWith('#'))
      node.properties = { ...node.properties, target: '_self', rel: undefined }
    for (const child of node.children ?? []) visit(child)
  }
  return visit
}

type SanitizeSchema = { tagNames: string[]; attributes: Record<string, unknown[]> }
const [sanitize, schema] = defaultRehypePlugins.sanitize as [unknown, SanitizeSchema]
// Keep the custom elements produced by Jetty's link and media plugins.
const rehypePlugins = [
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
  rehypeLocalLinks,
  rehypeMarkdownMedia,
] as StreamdownProps['rehypePlugins']
const htmlRehypePlugins = [
  defaultRehypePlugins.raw,
  ...(rehypePlugins ?? []),
] as StreamdownProps['rehypePlugins']

// Streamdown parses a block every time it mounts, and a thread switch remounts every message.
// This is its Block render (Streamdown 2.6.0) keeping each tree by text, so a block parses once.
// It skips what the app never sets (dir, indentation normalising, animation, element filters,
// HTML handling) and the incomplete-fence context only a streaming block needs.
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
const HtmlMarkdownBlock = cachedBlock()

export function Markdown({
  children,
  streaming,
  arrived,
  reply,
  onRevealComplete,
  html,
  className = 'text-sm leading-relaxed',
}: {
  children: string
  // GitHub-authored text (PR bodies, review comments), whose HTML renders; agents' text never does.
  html?: boolean
  streaming?: boolean
  // Complete a moment ago, so it rolls in like a stream rather than appearing at once.
  arrived?: boolean
  // The reply's id, so mounting it again carries on what it showed before.
  reply?: string
  onRevealComplete?: () => void
  className?: string
}) {
  // What shows at once: all of a stream so far, else what this reply already showed, else nothing
  // of one that just arrived and all of anything else.
  const [from] = useState(() =>
    streaming
      ? children.length
      : Math.min(children.length, replyShown(reply) ?? (arrived ? 0 : children.length))
  )
  // The chat feel streaming when it mounted; ⌥⌘F remounts the thread to change it.
  const feel = useChatFeel()
  const settled = useChatSettled()
  const hybridPacing = useHybridPacing()
  const [stream] = useState(() => streamFeels[feel])
  // A message that mounts mid-stream keeps Streamdown's blocks for life, swapping would remount it.
  const [smooth] = useState(() =>
    streaming || from < children.length ? stream.smoothBlocks(children.slice(0, from)) : undefined
  )
  const [BlockComponent] = useState(
    () => smooth?.SmoothBlock ?? (html ? HtmlMarkdownBlock : MarkdownBlock)
  )
  useEffect(() => smooth?.mounted(), [smooth])
  const text = !settled && smooth && streaming ? stream.wholeWords(children) : children
  const pacing =
    feel === 'hybrid'
      ? streamFeels[hybridPacing === 'none' ? 'capy' : hybridPacing].pacing
      : stream.pacing
  const shown = usePacedText(text, settled ? undefined : smooth && from, pacing)
  useReplyShown(reply, shown.length)
  const animating = !settled && (streaming || shown !== text)
  const markdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (animating || !onRevealComplete) return
    const animations = markdownRef
      .current!.getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().iterations === 1)
    let active = true
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (active) onRevealComplete()
    })
    return () => {
      active = false
    }
  }, [animating, shown, onRevealComplete])
  const markdown = (
    <Streamdown
      className={cn(className, animating && 'markdown-streaming')}
      components={components}
      linkSafety={linkSafety}
      isAnimating={animating}
      remarkPlugins={html ? htmlRemarkPlugins : remarkPlugins}
      rehypePlugins={html ? htmlRehypePlugins : rehypePlugins}
      BlockComponent={BlockComponent}
      parseMarkdownIntoBlocksFn={blocksWithDefinitions}
    >
      {shown}
    </Streamdown>
  )
  return onRevealComplete ? (
    <div ref={markdownRef} className='contents'>
      {markdown}
    </div>
  ) : (
    markdown
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

// One line of plain text for a preview: images drop out, code blocks become a label.
export function markdownText(markdown: string) {
  return nodeText(textParser.parse(markdown)).replace(/\s+/g, ' ').trim()
}
