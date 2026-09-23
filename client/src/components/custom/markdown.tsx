import { createCodePlugin, shikiThemes } from '@/components/custom/code_plugin'
import { FileLink, fileLinkTag, remarkFileLinks } from '@/components/custom/file_link'
import { MarkdownTable } from '@/components/custom/markdown_table'
import remarkBreaks from 'remark-breaks'
import { defaultRemarkPlugins, Streamdown } from 'streamdown'
import 'streamdown/styles.css'

const codePlugin = createCodePlugin()
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks, remarkFileLinks]
const components = { table: MarkdownTable, 'file-link': FileLink }
// Links open in a new tab; streamdown's confirm modal is a speed bump with no focus handling.
const linkSafety = { enabled: false }

export function Markdown({ children, streaming }: { children: string; streaming?: boolean }) {
  return (
    <Streamdown
      className='text-sm leading-relaxed'
      components={components}
      allowedTags={fileLinkTag}
      linkSafety={linkSafety}
      isAnimating={streaming}
      plugins={{ code: codePlugin }}
      remarkPlugins={remarkPlugins}
      shikiTheme={shikiThemes}
    >
      {children}
    </Streamdown>
  )
}
