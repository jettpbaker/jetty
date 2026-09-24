import { createCodePlugin, shikiThemes } from '@/components/custom/code_plugin'
import { FileLink, fileLinkTag, remarkFileLinks } from '@/components/custom/file_link'
import { GithubMedia, githubMediaTags, rehypeGithubMedia } from '@/components/custom/github_media'
import { MarkdownTable } from '@/components/custom/markdown_table'
import remarkBreaks from 'remark-breaks'
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  type StreamdownProps,
} from 'streamdown'
import 'streamdown/styles.css'

const codePlugin = createCodePlugin()
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks, remarkFileLinks]
const components = { table: MarkdownTable, 'file-link': FileLink, 'github-media': GithubMedia }
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

export function Markdown({
  children,
  streaming,
  githubMedia,
}: {
  children: string
  streaming?: boolean
  githubMedia?: boolean
}) {
  return (
    <Streamdown
      className='text-sm leading-relaxed'
      components={components}
      allowedTags={fileLinkTag}
      linkSafety={linkSafety}
      isAnimating={streaming}
      plugins={{ code: codePlugin }}
      remarkPlugins={remarkPlugins}
      rehypePlugins={githubMedia ? githubRehypePlugins : undefined}
      shikiTheme={shikiThemes}
    >
      {children}
    </Streamdown>
  )
}
