import { createCodePlugin, shikiThemes } from '@/components/custom/code_plugin'
import { MarkdownTable } from '@/components/custom/markdown_table'
import remarkBreaks from 'remark-breaks'
import { defaultRemarkPlugins, Streamdown } from 'streamdown'
import 'streamdown/styles.css'

const codePlugin = createCodePlugin()
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks]
const components = { table: MarkdownTable }
// Links open in a new tab; streamdown's confirm modal is a speed bump with no focus handling.
const linkSafety = { enabled: false }

export function AssistantMessage({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown
      className='text-sm leading-relaxed'
      components={components}
      linkSafety={linkSafety}
      isAnimating={streaming}
      plugins={{ code: codePlugin }}
      remarkPlugins={remarkPlugins}
      shikiTheme={shikiThemes}
    >
      {text}
    </Streamdown>
  )
}
