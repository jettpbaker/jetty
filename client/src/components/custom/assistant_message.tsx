import { createCodePlugin, shikiThemes } from '@/components/custom/code_plugin'
import remarkBreaks from 'remark-breaks'
import { defaultRemarkPlugins, Streamdown } from 'streamdown'
import 'streamdown/styles.css'

const codePlugin = createCodePlugin()
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks]

export function AssistantMessage({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown
      className='text-sm leading-relaxed'
      isAnimating={streaming}
      plugins={{ code: codePlugin }}
      remarkPlugins={remarkPlugins}
      shikiTheme={shikiThemes}
    >
      {text}
    </Streamdown>
  )
}
