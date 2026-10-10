import type { AssistantText, StreamPresentation, StreamTurn } from '@/streaming/engine'
import type { ReactNode } from 'react'

export type StreamTextRenderer = (text: string) => ReactNode

export function PlainStreamText(text: string) {
  return <div className='whitespace-pre-wrap wrap-break-word text-sm leading-relaxed'>{text}</div>
}

export function StreamingText({
  item,
  renderText = PlainStreamText,
}: {
  item: AssistantText
  renderText?: StreamTextRenderer
}) {
  return (
    <div data-stream-item={item.id} data-stream-completed={item.completed}>
      {renderText(item.text)}
    </div>
  )
}

const outcomeText: Record<StreamTurn['outcome'], string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  interrupted: 'Interrupted',
}

export function StreamingTurnStatus({ presentation }: { presentation: StreamPresentation }) {
  const turn = presentation.turns.at(-1)
  const unknown = presentation.captureEnded && turn?.outcome === 'running'
  return (
    <output className='text-sm text-muted-foreground' data-turn-outcome={turn?.outcome ?? 'none'}>
      {unknown
        ? 'Capture ended — outcome unknown'
        : turn
          ? outcomeText[turn.outcome]
          : 'Not started'}
      {turn?.error && `: ${turn.error}`}
      {presentation.captureIncomplete && ' · Incomplete capture'}
    </output>
  )
}
