import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import {
  useBot,
  usePendingBotMessages,
  useSendingIds,
  useSendToBot,
  useSendTurn,
  useThreadStructure,
  useThreadMeta,
} from '@/state'
import { useProviderUnavailable } from '@/state/models'

import { ArrowRotateClockwiseIcon } from './central_icons'
import { CopyButton } from './copy_button'
import { DisabledTooltip } from './disabled_tooltip'
import { StatusGlyph } from './thread_status'
import { providerNames } from './usage_limits'

// A failed turn, with Retry under it while it is the latest turn and the thread is idle.
export function ErrorMessage({
  message,
  threadId,
  turnId,
}: {
  message: string
  threadId: string
  turnId: string
}) {
  const thread = useThreadStructure(threadId)
  const isBot = useBot(threadId) !== undefined
  const provider = useThreadMeta(threadId)?.provider
  const providerUnavailable = useProviderUnavailable(provider)
  const unavailable =
    !isBot && provider && providerUnavailable
      ? `Connect ${providerNames[provider]} in Settings to retry this turn`
      : undefined
  const sending = useSendingIds(threadId)
  const pendingBot = usePendingBotMessages(threadId)
  const sendTurn = useSendTurn()
  const sendToBot = useSendToBot()
  const sent = thread?.items.findLast(
    (item) => item.turnId === turnId && item.kind === 'user_message' && !item.from
  )
  const first = thread?.items.find((item) => item.turnId === turnId && item.kind === 'user_message')
  // A thread's own send can't carry attachments it has already stored; a bot's can.
  const retryable =
    sent?.kind === 'user_message' &&
    first?.kind === 'user_message' &&
    !first.from &&
    (isBot || sent.attachments.length === 0)
  const latest = thread && Object.keys(thread.turnOutcomes).at(-1) === turnId
  const failed =
    retryable &&
    latest &&
    thread.lastTurnOutcome === 'failed' &&
    !thread.activeTurnId &&
    sending.length === 0 &&
    pendingBot.length === 0
  function retry() {
    if (!failed || unavailable) return
    if (isBot) sendToBot(threadId, sent.text, sent.replies, sent.attachments)
    else sendTurn(threadId, sent.text, undefined, [], sent.replies)
  }
  return (
    <Message align='start'>
      <MessageContent className='flex-row items-start gap-2 rounded-sm bg-status-error-wash p-3'>
        <StatusGlyph status='error' className='mt-1' />
        <div className='flex min-w-0 flex-1 flex-col gap-2'>
          <p className='text-sm text-foreground'>{message}</p>
          <div className='flex items-center gap-2'>
            {failed && (
              <DisabledTooltip reason={unavailable} wrap='self-start'>
                <Button variant='outline' size='xs' onClick={retry} disabled={!!unavailable}>
                  <ArrowRotateClockwiseIcon />
                  Retry
                </Button>
              </DisabledTooltip>
            )}
            <CopyButton text={message} label='Copy error' />
          </div>
        </div>
      </MessageContent>
    </Message>
  )
}
