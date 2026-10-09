import { Block, type BlockProps } from 'streamdown'

import type { StreamFeel } from './jetty'

// opencode's streaming, rebuilt from ~/code/scratch/teardowns/chat-opencode.md: text shows as it
// arrives, mid-word included, with no fade or caret. Only a backlog over 512 characters paces, a
// quarter of it every 24ms (PacedMarkdown, session-ui message-part.tsx).
function PlainBlock(props: BlockProps) {
  return <Block {...props} />
}

export const stream: StreamFeel = {
  smoothBlocks: () => ({ SmoothBlock: PlainBlock, mounted: () => undefined }),
  wholeWords: (text) => text,
  pacing: { lump: 512, ms: 24, chars: 128, count: 4, steady: false },
}
