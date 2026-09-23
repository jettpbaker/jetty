import { createCodePlugin, shikiThemes } from '@/components/custom/code_plugin'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'

const codePlugin = createCodePlugin()

export function AssistantMessage({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown
      className='text-sm leading-relaxed'
      isAnimating={streaming}
      plugins={{ code: codePlugin }}
      shikiTheme={shikiThemes}
    >
      {text}
    </Streamdown>
  )
}
