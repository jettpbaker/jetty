import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import pixelCircle from '@/fonts/GeistPixel-Circle.woff2'
import pixelGrid from '@/fonts/GeistPixel-Grid.woff2'
import pixelLine from '@/fonts/GeistPixel-Line.woff2'
import pixelSquare from '@/fonts/GeistPixel-Square.woff2'
import pixelTriangle from '@/fonts/GeistPixel-Triangle.woff2'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/scratchpad')({
  component: ScratchpadPage,
})

const PIXEL_VARIANTS = [
  ['Geist Pixel Square', pixelSquare],
  ['Geist Pixel Grid', pixelGrid],
  ['Geist Pixel Triangle', pixelTriangle],
  ['Geist Pixel Line', pixelLine],
  ['Geist Pixel Circle', pixelCircle],
] as const

const fontFaces = PIXEL_VARIANTS.map(
  ([family, url]) =>
    `@font-face { font-family: '${family}'; src: url('${url}') format('woff2'); font-weight: 500; }`
).join('\n')

// Design-pass playground: throwaway experiments only, nothing routes here.
function ScratchpadPage() {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-8 p-8'>
      <style>{fontFaces}</style>
      <h1
        className='text-9xl tracking-[0.15em]'
        style={{
          fontFamily: "'Geist Pixel Square'",
          WebkitTextStroke: '2px currentColor',
        }}
      >
        Jetty
      </h1>
      <div className='w-full max-w-2xl'>
        <PromptInput onSubmit={() => {}}>
          <PromptInputTextarea placeholder='Message the agent…' />
          <PromptInputFooter>
            <PromptInputSubmit className='ml-auto' status='ready' />
          </PromptInputFooter>
        </PromptInput>
      </div>
      <div className='flex flex-wrap justify-center gap-6 text-muted-foreground'>
        {PIXEL_VARIANTS.map(([family]) => (
          <span key={family} className='text-xl' style={{ fontFamily: `'${family}'` }}>
            {family.replace('Geist Pixel ', '')}
          </span>
        ))}
      </div>
    </div>
  )
}
