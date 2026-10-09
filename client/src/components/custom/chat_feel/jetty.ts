import { jettyPacing, smoothBlocks, wholeWords, type Pacing } from '../smooth_stream'

// How a feel streams a reply. `smoothBlocks` builds the BlockComponent that fades new text in;
// `wholeWords` trims a streaming reply to what may show; `pacing` sets how text that ran ahead
// catches up. Markdown picks one when it mounts.
export type StreamFeel = {
  smoothBlocks: typeof smoothBlocks
  wholeWords: typeof wholeWords
  pacing: Pacing
}

export const jettyStream: StreamFeel = { smoothBlocks, wholeWords, pacing: jettyPacing }
