import { CodePre } from '@/components/custom/code_block'
import { FileLink, fileLinkTag, remarkFileLinks } from '@/components/custom/file_link'
import { GithubMedia, githubMediaTags, rehypeGithubMedia } from '@/components/custom/github_media'
import { MarkdownTable } from '@/components/custom/markdown_table'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { useState, type ReactElement } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import remarkBreaks from 'remark-breaks'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {
  Block,
  type BlockProps,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  type StreamdownProps,
} from 'streamdown'
import 'streamdown/styles.css'
import { unified, type PluggableList } from 'unified'

const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks, remarkFileLinks]
const components = {
  pre: CodePre,
  table: MarkdownTable,
  'file-link': FileLink,
  'github-media': GithubMedia,
}
// Links open in a new tab; streamdown's confirm modal is a speed bump with no focus handling.
const linkSafety = { enabled: false }

type SanitizeSchema = { tagNames: string[]; attributes: Record<string, unknown[]> }
const [sanitize, schema] = defaultRehypePlugins.sanitize as [unknown, SanitizeSchema]
// Streamdown ignores allowedTags once the pipeline is custom, so file links are listed here too.
const githubRehypePlugins = [
  defaultRehypePlugins.raw,
  [
    sanitize,
    {
      ...schema,
      tagNames: [...schema.tagNames, ...Object.keys(fileLinkTag), ...Object.keys(githubMediaTags)],
      attributes: { ...schema.attributes, ...fileLinkTag, ...githubMediaTags },
    },
  ],
  defaultRehypePlugins.harden,
  rehypeGithubMedia,
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
const GithubBlock = cachedBlock()

export function Markdown({
  children,
  streaming,
  githubMedia,
  className = 'text-sm leading-relaxed',
}: {
  children: string
  streaming?: boolean
  githubMedia?: boolean
  className?: string
}) {
  // A message that mounts mid-stream keeps Streamdown's blocks for life, swapping would remount it.
  const [BlockComponent] = useState(() =>
    streaming ? Block : githubMedia ? GithubBlock : MarkdownBlock
  )
  return (
    <Streamdown
      className={className}
      components={components}
      allowedTags={fileLinkTag}
      linkSafety={linkSafety}
      isAnimating={streaming}
      remarkPlugins={remarkPlugins}
      rehypePlugins={githubMedia ? githubRehypePlugins : undefined}
      BlockComponent={BlockComponent}
    >
      {children}
    </Streamdown>
  )
}
